use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    ffi::{c_void, OsString},
    mem::{size_of, zeroed},
    path::{Path, PathBuf},
    process::Command,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use tauri::{AppHandle, Emitter, Manager};

use crate::match_detector::{
    self, detect_icons, is_score_screen, line_endpoint, PlayerInfo, RgbFrame, ANALYSIS_TIMEOUT,
    RETRY_DELAY, SCORE_SCREEN_POLL, SCORE_TAB_ROI, SKIP_BUTTON_FRAC, SLOT_SETTLE, TAB_SETTLE,
};

#[cfg(target_os = "windows")]
type Handle = *mut c_void;
#[cfg(target_os = "windows")]
type Hwnd = Handle;
#[cfg(target_os = "windows")]
type HookProc = Option<unsafe extern "system" fn(i32, usize, isize) -> isize>;
#[cfg(target_os = "windows")]
type EnumWindowsProc = Option<unsafe extern "system" fn(Hwnd, isize) -> i32>;

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Point {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy)]
struct MouseInput {
    dx: i32,
    dy: i32,
    mouse_data: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy)]
struct KeyboardInput {
    vk: u16,
    scan: u16,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy)]
struct HardwareInput {
    message: u32,
    param_l: u16,
    param_h: u16,
}

#[cfg(target_os = "windows")]
#[repr(C)]
union InputUnion {
    mouse: MouseInput,
    keyboard: KeyboardInput,
    hardware: HardwareInput,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct Input {
    input_type: u32,
    data: InputUnion,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct ProcessEntry32W {
    size: u32,
    usage: u32,
    process_id: u32,
    default_heap_id: usize,
    module_id: u32,
    threads: u32,
    parent_process_id: u32,
    priority_class_base: i32,
    flags: u32,
    exe_file: [u16; 260],
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct KeyboardHookData {
    vk_code: u32,
    scan_code: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct MouseHookData {
    point: Point,
    mouse_data: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct Message {
    window: Hwnd,
    message: u32,
    w_param: usize,
    l_param: isize,
    time: u32,
    point: Point,
    private: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct ShellExecuteInfoW {
    size: u32,
    mask: u32,
    window: Hwnd,
    verb: *const u16,
    file: *const u16,
    parameters: *const u16,
    directory: *const u16,
    show: i32,
    instance: Handle,
    id_list: *mut c_void,
    class: *const u16,
    class_key: Handle,
    hot_key: u32,
    icon_or_monitor: Handle,
    process: Handle,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct BitmapInfoHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_pixels_per_meter: i32,
    y_pixels_per_meter: i32,
    colors_used: u32,
    colors_important: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct WindowsSystemTime {
    year: u16,
    month: u16,
    day_of_week: u16,
    day: u16,
    hour: u16,
    minute: u16,
    second: u16,
    milliseconds: u16,
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn FindWindowW(class_name: *const u16, window_name: *const u16) -> Hwnd;
    fn EnumWindows(callback: EnumWindowsProc, parameter: isize) -> i32;
    fn GetWindowThreadProcessId(window: Hwnd, process_id: *mut u32) -> u32;
    fn GetClientRect(window: Hwnd, rect: *mut Rect) -> i32;
    fn ClientToScreen(window: Hwnd, point: *mut Point) -> i32;
    fn GetSystemMetrics(index: i32) -> i32;
    fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
    fn SetForegroundWindow(window: Hwnd) -> i32;
    fn IsWindowVisible(window: Hwnd) -> i32;
    fn GetDC(window: Hwnd) -> Handle;
    fn ReleaseDC(window: Hwnd, dc: Handle) -> i32;
    fn SetWindowsHookExW(
        id_hook: i32,
        callback: HookProc,
        module: Handle,
        thread_id: u32,
    ) -> Handle;
    fn CallNextHookEx(hook: Handle, code: i32, w_param: usize, l_param: isize) -> isize;
    fn UnhookWindowsHookEx(hook: Handle) -> i32;
    fn GetMessageW(message: *mut Message, window: Hwnd, min: u32, max: u32) -> i32;
    fn TranslateMessage(message: *const Message) -> i32;
    fn DispatchMessageW(message: *const Message) -> isize;
    fn GetCursorPos(point: *mut Point) -> i32;
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> Handle;
    fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
    fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
    fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
    fn CloseHandle(handle: Handle) -> i32;
    fn GetLastError() -> u32;
    fn GetLocalTime(system_time: *mut WindowsSystemTime);
    fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> Handle;
    fn TerminateProcess(handle: Handle, exit_code: u32) -> i32;
    fn GetExitCodeProcess(handle: Handle, exit_code: *mut u32) -> i32;
}

#[cfg(target_os = "windows")]
#[link(name = "shell32")]
extern "system" {
    fn IsUserAnAdmin() -> i32;
    fn ShellExecuteExW(info: *mut ShellExecuteInfoW) -> i32;
}

#[cfg(target_os = "windows")]
#[link(name = "advapi32")]
extern "system" {
    fn RegOpenKeyExW(
        root: Handle,
        sub_key: *const u16,
        options: u32,
        access: u32,
        result: *mut Handle,
    ) -> i32;
    fn RegQueryValueExW(
        key: Handle,
        value_name: *const u16,
        reserved: *mut u32,
        value_type: *mut u32,
        data: *mut u8,
        data_size: *mut u32,
    ) -> i32;
    fn RegCloseKey(key: Handle) -> i32;
}

#[cfg(target_os = "windows")]
#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(dc: Handle) -> Handle;
    fn CreateCompatibleBitmap(dc: Handle, width: i32, height: i32) -> Handle;
    fn SelectObject(dc: Handle, object: Handle) -> Handle;
    fn BitBlt(
        destination: Handle,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        source: Handle,
        source_x: i32,
        source_y: i32,
        operation: u32,
    ) -> i32;
    fn GetDIBits(
        dc: Handle,
        bitmap: Handle,
        start: u32,
        lines: u32,
        bits: *mut c_void,
        info: *mut BitmapInfoHeader,
        usage: u32,
    ) -> i32;
    fn DeleteObject(object: Handle) -> i32;
    fn DeleteDC(dc: Handle) -> i32;
}

#[cfg(target_os = "windows")]
const INPUT_MOUSE: u32 = 0;
#[cfg(target_os = "windows")]
const MOUSE_MOVE: u32 = 0x0001;
#[cfg(target_os = "windows")]
const MOUSE_LEFT_DOWN: u32 = 0x0002;
#[cfg(target_os = "windows")]
const MOUSE_LEFT_UP: u32 = 0x0004;
#[cfg(target_os = "windows")]
const MOUSE_WHEEL: u32 = 0x0800;
#[cfg(target_os = "windows")]
const MOUSE_ABSOLUTE: u32 = 0x8000;
#[cfg(target_os = "windows")]
const INJECT_MAGIC: usize = 0x57415231;
#[cfg(target_os = "windows")]
const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
#[cfg(target_os = "windows")]
const WH_KEYBOARD_LL: i32 = 13;
#[cfg(target_os = "windows")]
const WH_MOUSE_LL: i32 = 14;
#[cfg(target_os = "windows")]
const SEE_MASK_NOCLOSEPROCESS: u32 = 0x0000_0040;
#[cfg(target_os = "windows")]
const SEE_MASK_FLAG_NO_UI: u32 = 0x0000_0400;
#[cfg(target_os = "windows")]
const INFINITE: u32 = 0xFFFF_FFFF;
#[cfg(target_os = "windows")]
const WAIT_FAILED: u32 = 0xFFFF_FFFF;
#[cfg(target_os = "windows")]
const KEY_READ: u32 = 0x0002_0019;
#[cfg(target_os = "windows")]
const KEY_WOW64_64KEY: u32 = 0x0000_0100;
#[cfg(target_os = "windows")]
const KEY_WOW64_32KEY: u32 = 0x0000_0200;
#[cfg(target_os = "windows")]
const HKEY_CURRENT_USER: Handle = 0x8000_0001usize as Handle;
#[cfg(target_os = "windows")]
const HKEY_LOCAL_MACHINE: Handle = 0x8000_0002usize as Handle;
#[cfg(target_os = "windows")]
const SRCCOPY: u32 = 0x00CC_0020;
#[cfg(target_os = "windows")]
const DIB_RGB_COLORS: u32 = 0;
#[cfg(target_os = "windows")]
const PROCESS_TERMINATE: u32 = 0x0001;
#[cfg(target_os = "windows")]
const STILL_ACTIVE: u32 = 259;
#[cfg(target_os = "windows")]
const WM_KEYDOWN: usize = 0x0100;
#[cfg(target_os = "windows")]
const WM_SYSKEYDOWN: usize = 0x0104;
#[cfg(target_os = "windows")]
const VK_CAPTURE: u32 = 0x78; // F9
#[cfg(target_os = "windows")]
const VK_QUIT: u32 = 0x79; // F10
#[cfg(target_os = "windows")]
const MENU_MARKER_MATCH: f64 = 0.85;
#[cfg(target_os = "windows")]
const MENU_MARKER_TOLERANCE: i16 = 30;
#[cfg(target_os = "windows")]
const MENU_MARKER_POLL: Duration = Duration::from_secs(1);
#[cfg(target_os = "windows")]
const MENU_MARKER_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg(target_os = "windows")]
const MENU_MARKER_NPY: &[u8] = include_bytes!("../assets/menu_marker.npy");
#[cfg(target_os = "windows")]
const MENU_MARKER_META: &str = include_str!("../assets/menu_marker.json");

pub const CALIBRATION_RESOLUTION: &str = "1280 720";
const CALIBRATION_RESTORE_AFTER: Duration = Duration::from_secs(5);
const CALIBRATION_EVENT: &str = "wotr://calibration";
const START_POS_CLICK_GAP: Duration = Duration::from_millis(200);
const START_COUNTDOWN: Duration = Duration::from_secs(7);
const MONITOR_DEFAULT_TIMEOUT: Duration = Duration::from_secs(5400);
const HELPER_RESULT_TIMEOUT: Duration = Duration::from_secs(900);

#[cfg(target_os = "windows")]
static INPUT_BLOCKING: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static INPUT_HOOKS_READY: OnceLock<Result<(), String>> = OnceLock::new();
#[cfg(target_os = "windows")]
static CALIBRATION_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static CALIBRATION_KEYS: OnceLock<mpsc::Sender<u32>> = OnceLock::new();
#[cfg(target_os = "windows")]
static AUTOMATION_BUSY: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

#[cfg(target_os = "windows")]
struct AutomationLog {
    started: Instant,
}

#[cfg(target_os = "windows")]
impl AutomationLog {
    fn start() -> Self {
        Self {
            started: Instant::now(),
        }
    }
    fn write(&self, message: impl AsRef<str>) {
        let mut now = WindowsSystemTime::default();
        unsafe { GetLocalTime(&mut now) };
        println!(
            "[{:02}:{:02}:{:02} +{:6.1}s] {}",
            now.hour,
            now.minute,
            now.second,
            self.started.elapsed().as_secs_f64(),
            message.as_ref()
        );
    }
}

#[cfg(target_os = "windows")]
fn last_error() -> u32 {
    unsafe { GetLastError() }
}

#[cfg(target_os = "windows")]
fn process_ids_by_name(name: &str) -> Result<Vec<u32>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot as isize == -1 {
        return Err(format!(
            "CreateToolhelp32Snapshot завершился ошибкой {}",
            last_error()
        ));
    }
    let mut entry: ProcessEntry32W = unsafe { zeroed() };
    entry.size = size_of::<ProcessEntry32W>() as u32;
    let mut result = Vec::new();
    let first = unsafe { Process32FirstW(snapshot, &mut entry) };
    if first != 0 {
        loop {
            let end = entry
                .exe_file
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(entry.exe_file.len());
            let executable = String::from_utf16_lossy(&entry.exe_file[..end]);
            if executable.eq_ignore_ascii_case(name) {
                result.push(entry.process_id);
            }
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe {
        CloseHandle(snapshot);
    }
    Ok(result)
}

#[cfg(target_os = "windows")]
struct WindowSearch {
    process_ids: Vec<u32>,
    best_window: Hwnd,
    best_area: i64,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_game_windows(window: Hwnd, parameter: isize) -> i32 {
    let search = &mut *(parameter as *mut WindowSearch);
    if IsWindowVisible(window) == 0 {
        return 1;
    }
    let mut process_id = 0u32;
    GetWindowThreadProcessId(window, &mut process_id);
    if !search.process_ids.contains(&process_id) {
        return 1;
    }
    let mut rect = Rect::default();
    if GetClientRect(window, &mut rect) == 0 {
        return 1;
    }
    let area =
        i64::from((rect.right - rect.left).max(0)) * i64::from((rect.bottom - rect.top).max(0));
    if area > search.best_area {
        search.best_area = area;
        search.best_window = window;
    }
    1
}

#[cfg(target_os = "windows")]
fn find_window_for_processes(process_ids: Vec<u32>) -> Option<Hwnd> {
    if process_ids.is_empty() {
        return None;
    }
    let mut search = WindowSearch {
        process_ids,
        best_window: null_mut(),
        best_area: 0,
    };
    unsafe {
        EnumWindows(
            Some(enum_game_windows),
            &mut search as *mut WindowSearch as isize,
        );
    }
    (!search.best_window.is_null()).then_some(search.best_window)
}

#[cfg(target_os = "windows")]
fn find_game_window() -> Option<(Hwnd, &'static str)> {
    if let Ok(process_ids) = process_ids_by_name("game.dat") {
        if let Some(window) = find_window_for_processes(process_ids) {
            return Some((window, "процесс game.dat"));
        }
    }
    // Резервный путь нужен для сборок, где реальный процесс переименован,
    // но SAGE оставляет стандартный класс окна.
    for name in ["SAGE_Window", "SAGE_WINDOW"] {
        let class = wide(name);
        let window = unsafe { FindWindowW(class.as_ptr(), null()) };
        if !window.is_null() && unsafe { IsWindowVisible(window) } != 0 {
            return Some((window, "класс окна SAGE"));
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn game_process_is_running() -> bool {
    process_ids_by_name("game.dat")
        .map(|ids| !ids.is_empty())
        .unwrap_or(false)
        || find_game_window().is_some()
}

#[cfg(target_os = "windows")]
fn wait_for_game_window(timeout: Duration) -> Result<(Hwnd, &'static str), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(window) = find_game_window() {
            return Ok(window);
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err(
        "Окно процесса game.dat не появилось за 120 секунд. Закройте BFME и повторите запуск."
            .into(),
    )
}

/// Force-close every running game.dat (ported from the Python bridge launcher.stop_game).
#[cfg(target_os = "windows")]
pub fn stop_game() -> bool {
    let Ok(pids) = process_ids_by_name("game.dat") else {
        return true;
    };
    if pids.is_empty() {
        return true;
    }
    for pid in pids {
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if handle.is_null() {
                continue;
            }
            TerminateProcess(handle, 1);
            CloseHandle(handle);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if !game_process_is_running() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    !game_process_is_running()
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn keyboard_hook(code: i32, w_param: usize, l_param: isize) -> isize {
    if code >= 0 && INPUT_BLOCKING.load(Ordering::Relaxed) {
        let data = &*(l_param as *const KeyboardHookData);
        if data.extra_info != INJECT_MAGIC {
            return 1;
        }
    }
    CallNextHookEx(null_mut(), code, w_param, l_param)
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn mouse_hook(code: i32, w_param: usize, l_param: isize) -> isize {
    if code >= 0 && INPUT_BLOCKING.load(Ordering::Relaxed) {
        let data = &*(l_param as *const MouseHookData);
        if data.extra_info != INJECT_MAGIC {
            return 1;
        }
    }
    CallNextHookEx(null_mut(), code, w_param, l_param)
}

#[cfg(target_os = "windows")]
fn input_hook_loop(ready: mpsc::Sender<Result<(), String>>) {
    unsafe {
        let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), null_mut(), 0);
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), null_mut(), 0);
        if keyboard.is_null() || mouse.is_null() {
            let error = format!(
                "Не удалось установить блокировку ввода: keyboard={keyboard:p}, mouse={mouse:p}, Windows error={}",
                last_error()
            );
            if !keyboard.is_null() {
                UnhookWindowsHookEx(keyboard);
            }
            if !mouse.is_null() {
                UnhookWindowsHookEx(mouse);
            }
            let _ = ready.send(Err(error));
            return;
        }
        let _ = ready.send(Ok(()));
        let mut message: Message = zeroed();
        loop {
            let status = GetMessageW(&mut message, null_mut(), 0, 0);
            if status <= 0 {
                break;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        UnhookWindowsHookEx(keyboard);
        UnhookWindowsHookEx(mouse);
    }
}

#[cfg(target_os = "windows")]
fn ensure_input_hooks() -> Result<(), String> {
    INPUT_HOOKS_READY
        .get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            thread::Builder::new()
                .name("bfme-input-lock".into())
                .spawn(move || input_hook_loop(sender))
                .map_err(|error| format!("Не удалось создать поток блокировки ввода: {error}"))?;
            receiver
                .recv_timeout(Duration::from_secs(5))
                .map_err(|_| "Блокировка ввода не ответила за 5 секунд".to_string())?
        })
        .clone()
}

#[cfg(target_os = "windows")]
struct InputLockGuard;

#[cfg(target_os = "windows")]
impl InputLockGuard {
    fn acquire() -> Result<Self, String> {
        ensure_input_hooks()?;
        if INPUT_BLOCKING.swap(true, Ordering::SeqCst) {
            return Err("Автоматизация BFME уже управляет мышью и клавиатурой".into());
        }
        println!("[BFME] Физический ввод заблокирован; Ctrl+Alt+Del остаётся доступен.");
        Ok(Self)
    }
}

#[cfg(target_os = "windows")]
impl Drop for InputLockGuard {
    fn drop(&mut self) {
        INPUT_BLOCKING.store(false, Ordering::SeqCst);
        println!("[BFME] Физический ввод разблокирован.");
    }
}

// ---------------------------------------------------------------------------
// Passive calibration hotkeys (F9 capture / F10 quit) — never blocks input.
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
unsafe extern "system" fn calibration_key_hook(code: i32, w_param: usize, l_param: isize) -> isize {
    if code >= 0 && CALIBRATION_ACTIVE.load(Ordering::Relaxed) && (w_param == WM_KEYDOWN || w_param == WM_SYSKEYDOWN) {
        let data = &*(l_param as *const KeyboardHookData);
        if (data.vk_code == VK_CAPTURE || data.vk_code == VK_QUIT) && data.extra_info != INJECT_MAGIC {
            if let Some(sender) = CALIBRATION_KEYS.get() {
                let _ = sender.send(data.vk_code);
            }
        }
    }
    CallNextHookEx(null_mut(), code, w_param, l_param)
}

#[cfg(target_os = "windows")]
fn calibration_hook_loop(ready: mpsc::Sender<Result<(), String>>) {
    unsafe {
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(calibration_key_hook), null_mut(), 0);
        if hook.is_null() {
            let _ = ready.send(Err(format!(
                "Не удалось установить горячие клавиши калибровки (Windows error {})",
                last_error()
            )));
            return;
        }
        let _ = ready.send(Ok(()));
        let mut message: Message = zeroed();
        loop {
            let status = GetMessageW(&mut message, null_mut(), 0, 0);
            if status <= 0 {
                break;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        UnhookWindowsHookEx(hook);
    }
}

#[cfg(target_os = "windows")]
fn ensure_calibration_hook() -> Result<std::sync::MutexGuard<'static, mpsc::Receiver<u32>>, String> {
    // The channel is created once and reused across calibration sessions:
    // a second session simply drains stale events before starting. The
    // receiver lives in a static Mutex because mpsc::Receiver is !Sync.
    static HOOK: OnceLock<Result<(), String>> = OnceLock::new();
    static RECEIVER: OnceLock<Mutex<mpsc::Receiver<u32>>> = OnceLock::new();
    let status = HOOK
        .get_or_init(|| {
            let (key_sender, key_receiver) = mpsc::channel::<u32>();
            let (ready_sender, ready_receiver) = mpsc::channel::<Result<(), String>>();
            if let Err(error) = thread::Builder::new()
                .name("bfme-calibration-keys".into())
                .spawn(move || calibration_hook_loop(ready_sender))
            {
                return Err(format!("Не удалось создать поток горячих клавиш: {error}"));
            }
            let ready = ready_receiver
                .recv_timeout(Duration::from_secs(5))
                .unwrap_or_else(|_| Err("Горячие клавиши калибровки не ответили за 5 секунд".to_string()));
            match ready {
                Ok(()) => {
                    // The LL-hook sends captured keys through this global sender.
                    let _ = CALIBRATION_KEYS.set(key_sender);
                    let _ = RECEIVER.set(Mutex::new(key_receiver));
                    Ok(())
                }
                Err(error) => Err(error),
            }
        })
        .clone();
    match status {
        Ok(()) => RECEIVER
            .get()
            .ok_or_else(|| "Канал горячих клавиш калибровки недоступен".to_string())?
            .lock()
            .map_err(|_| "Канал горячих клавиш калибровки заблокирован".to_string()),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "windows")]
fn cursor_position() -> Option<(i32, i32)> {
    let mut point = Point::default();
    if unsafe { GetCursorPos(&mut point) } != 0 {
        Some((point.x, point.y))
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn viewport(window: Hwnd) -> Result<(i32, i32, i32, i32), String> {
    let mut rect = Rect::default();
    if unsafe { GetClientRect(window, &mut rect) } == 0 {
        return Err(format!("GetClientRect завершился ошибкой {}", last_error()));
    }
    let mut origin = Point::default();
    if unsafe { ClientToScreen(window, &mut origin) } == 0 {
        return Err(format!(
            "ClientToScreen завершился ошибкой {}",
            last_error()
        ));
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width < 640 || height < 480 {
        return Err(format!("Окно BFME имеет неверный размер {width}×{height}"));
    }
    Ok((origin.x, origin.y, width, height))
}

#[cfg(target_os = "windows")]
struct MenuMarker {
    pixels: &'static [u8],
    width: usize,
    height: usize,
    fx: f64,
    fy: f64,
    size_fraction: f64,
}

#[cfg(target_os = "windows")]
fn load_menu_marker() -> Result<MenuMarker, String> {
    if MENU_MARKER_NPY.len() < 16 || &MENU_MARKER_NPY[..6] != b"\x93NUMPY" {
        return Err("Embedded menu marker has an invalid NPY header".into());
    }
    let major = MENU_MARKER_NPY[6];
    let (header_length, data_offset) = if major == 1 {
        let length = u16::from_le_bytes([MENU_MARKER_NPY[8], MENU_MARKER_NPY[9]]) as usize;
        (length, 10 + length)
    } else if major == 2 || major == 3 {
        let length = u32::from_le_bytes([
            MENU_MARKER_NPY[8],
            MENU_MARKER_NPY[9],
            MENU_MARKER_NPY[10],
            MENU_MARKER_NPY[11],
        ]) as usize;
        (length, 12 + length)
    } else {
        return Err(format!("Unsupported menu marker NPY version {major}"));
    };
    if data_offset > MENU_MARKER_NPY.len() {
        return Err("Embedded menu marker NPY data offset is invalid".into());
    }
    let header =
        String::from_utf8_lossy(&MENU_MARKER_NPY[data_offset - header_length..data_offset]);
    if !header.contains("'descr': '|u1'") || !header.contains("(21, 21, 3)") {
        return Err(format!("Unsupported menu marker array: {}", header.trim()));
    }
    let expected = 21 * 21 * 3;
    if MENU_MARKER_NPY.len() - data_offset != expected {
        return Err("Embedded menu marker has an unexpected pixel count".into());
    }
    let meta: Value = serde_json::from_str(MENU_MARKER_META)
        .map_err(|error| format!("Invalid menu marker metadata: {error}"))?;
    Ok(MenuMarker {
        pixels: &MENU_MARKER_NPY[data_offset..],
        width: 21,
        height: 21,
        fx: meta
            .get("fx")
            .and_then(Value::as_f64)
            .ok_or("menu marker fx is missing")?,
        fy: meta
            .get("fy")
            .and_then(Value::as_f64)
            .ok_or("menu marker fy is missing")?,
        size_fraction: meta
            .get("size_frac")
            .and_then(Value::as_f64)
            .ok_or("menu marker size_frac is missing")?,
    })
}

#[cfg(target_os = "windows")]
fn capture_screen_region_rgb(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    if width <= 0 || height <= 0 {
        return Err("Invalid screen capture size".into());
    }
    unsafe {
        let screen_dc = GetDC(null_mut());
        if screen_dc.is_null() {
            return Err(format!("GetDC failed: {}", last_error()));
        }
        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc.is_null() {
            ReleaseDC(null_mut(), screen_dc);
            return Err(format!("CreateCompatibleDC failed: {}", last_error()));
        }
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.is_null() {
            DeleteDC(memory_dc);
            ReleaseDC(null_mut(), screen_dc);
            return Err(format!("CreateCompatibleBitmap failed: {}", last_error()));
        }
        let old = SelectObject(memory_dc, bitmap);
        let copied = BitBlt(memory_dc, 0, 0, width, height, screen_dc, x, y, SRCCOPY);
        if copied == 0 {
            SelectObject(memory_dc, old);
            DeleteObject(bitmap);
            DeleteDC(memory_dc);
            ReleaseDC(null_mut(), screen_dc);
            return Err(format!("BitBlt failed: {}", last_error()));
        }
        let mut info = BitmapInfoHeader {
            size: size_of::<BitmapInfoHeader>() as u32,
            width,
            height: -height,
            planes: 1,
            bit_count: 32,
            ..Default::default()
        };
        let mut bgra = vec![0u8; (width as usize) * (height as usize) * 4];
        let lines = GetDIBits(
            memory_dc,
            bitmap,
            0,
            height as u32,
            bgra.as_mut_ptr() as *mut c_void,
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(memory_dc, old);
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(null_mut(), screen_dc);
        if lines == 0 {
            return Err(format!("GetDIBits failed: {}", last_error()));
        }
        let mut rgb = Vec::with_capacity((width as usize) * (height as usize) * 3);
        for pixel in bgra.chunks_exact(4) {
            rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]])
        }
        Ok(rgb)
    }
}

#[cfg(target_os = "windows")]
fn capture_viewport(view: (i32, i32, i32, i32)) -> Result<RgbFrame, String> {
    let data = capture_screen_region_rgb(view.0, view.1, view.2, view.3)?;
    Ok(RgbFrame {
        width: view.2 as usize,
        height: view.3 as usize,
        data,
    })
}

#[cfg(target_os = "windows")]
fn menu_marker_match(window: Hwnd, marker: &MenuMarker) -> Result<f64, String> {
    let (left, top, width, height) = viewport(window)?;
    let box_size = ((marker.size_fraction * f64::from(width.min(height))) as i32).max(4);
    let center_x = left + (marker.fx * f64::from(width)) as i32;
    let center_y = top + (marker.fy * f64::from(height)) as i32;
    let current = capture_screen_region_rgb(
        center_x - box_size / 2,
        center_y - box_size / 2,
        box_size,
        box_size,
    )?;
    let mut close = 0usize;
    let total = (box_size as usize) * (box_size as usize);
    for y in 0..box_size as usize {
        let source_y =
            ((y as f64 * (marker.height - 1) as f64) / (box_size as f64 - 1.0)).round() as usize;
        for x in 0..box_size as usize {
            let source_x =
                ((x as f64 * (marker.width - 1) as f64) / (box_size as f64 - 1.0)).round() as usize;
            let source = (source_y * marker.width + source_x) * 3;
            let target = (y * box_size as usize + x) * 3;
            if (0..3).all(|channel| {
                (i16::from(current[target + channel]) - i16::from(marker.pixels[source + channel]))
                    .abs()
                    <= MENU_MARKER_TOLERANCE
            }) {
                close += 1
            }
        }
    }
    Ok(close as f64 / total as f64)
}

#[cfg(target_os = "windows")]
fn wait_for_menu_ready(window: Hwnd, log: &AutomationLog, language: &str) -> Result<(), String> {
    let marker = load_menu_marker()?;
    let deadline = Instant::now() + MENU_MARKER_TIMEOUT;
    let mut attempts = 0usize;
    log.write("[wait] visual main-menu readiness detection started");
    while Instant::now() < deadline {
        attempts += 1;
        match menu_marker_match(window, &marker) {
            Ok(ratio) if ratio >= MENU_MARKER_MATCH => {
                log.write(format!(
                    "[wait] menu marker found ({:.1}%) — menu is ready",
                    ratio * 100.0
                ));
                return Ok(());
            }
            Ok(ratio) => {
                if attempts == 1 || attempts % 10 == 0 {
                    log.write(format!(
                        "[wait] menu marker match {:.1}%; still waiting",
                        ratio * 100.0
                    ))
                }
            }
            Err(error) => {
                if attempts == 1 || attempts % 10 == 0 {
                    log.write(format!("[wait] screen capture unavailable: {error}"))
                }
            }
        }
        thread::sleep(MENU_MARKER_POLL);
    }
    Err(if language == "en" {
        "The BFME main-menu marker did not appear within 60 seconds".into()
    } else {
        "Маркер главного меню BFME не появился за 60 секунд".into()
    })
}

#[cfg(target_os = "windows")]
fn mouse_input(flags: u32, dx: i32, dy: i32, data: i32) -> Input {
    Input {
        input_type: INPUT_MOUSE,
        data: InputUnion {
            mouse: MouseInput {
                dx,
                dy,
                mouse_data: data as u32,
                flags,
                time: 0,
                extra_info: INJECT_MAGIC,
            },
        },
    }
}

#[cfg(target_os = "windows")]
fn send(input: Input) -> Result<(), String> {
    let sent = unsafe { SendInput(1, &input, size_of::<Input>() as i32) };
    if sent != 1 {
        return Err(format!(
            "Windows заблокировал SendInput (ошибка {}). Автоматизация должна работать с теми же правами администратора, что и game.dat.",
            last_error()
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn move_mouse(x: i32, y: i32) -> Result<(), String> {
    let width = unsafe { GetSystemMetrics(0) }.max(1);
    let height = unsafe { GetSystemMetrics(1) }.max(1);
    let dx = x.saturating_mul(65535) / (width - 1).max(1);
    let dy = y.saturating_mul(65535) / (height - 1).max(1);
    send(mouse_input(MOUSE_MOVE | MOUSE_ABSOLUTE, dx, dy, 0))?;
    thread::sleep(Duration::from_millis(30));
    Ok(())
}

#[cfg(target_os = "windows")]
fn click(x: i32, y: i32) -> Result<(), String> {
    move_mouse(x, y)?;
    send(mouse_input(MOUSE_LEFT_DOWN, 0, 0, 0))?;
    thread::sleep(Duration::from_millis(50));
    send(mouse_input(MOUSE_LEFT_UP, 0, 0, 0))?;
    thread::sleep(Duration::from_millis(50));
    Ok(())
}

#[cfg(target_os = "windows")]
fn click_fraction(view: (i32, i32, i32, i32), x: f64, y: f64) -> Result<(), String> {
    click(
        view.0 + (x * view.2 as f64) as i32,
        view.1 + (y * view.3 as f64) as i32,
    )
}

#[cfg(target_os = "windows")]
fn scroll(notches: i32) -> Result<(), String> {
    send(mouse_input(MOUSE_WHEEL, 0, 0, notches * 120))?;
    thread::sleep(Duration::from_millis(50));
    Ok(())
}

#[cfg(target_os = "windows")]
const SLOT_Y: [f64; 8] = [
    0.5569, 0.5919, 0.6289, 0.6644, 0.6989, 0.7334, 0.7678, 0.8033,
];
#[cfg(target_os = "windows")]
const DIFF_OFFSETS: [f64; 4] = [0.0865, 0.1160, 0.1439, 0.1713];
#[cfg(target_os = "windows")]
const DROP_STEP: f64 = 0.029;
#[cfg(target_os = "windows")]
const DROP_GAP: f64 = 0.033;
/// Rating-column slot click coordinates on the «Счёт» screen (fractions of the
/// window), ported from the Python detector config. Slot 1 is selected by default.
#[cfg(target_os = "windows")]
const RATING_SLOT_FRAC: [(f64, f64); 7] = [
    (1626.0 / 1920.0, 359.0 / 1080.0),
    (1623.0 / 1920.0, 427.0 / 1080.0),
    (1622.0 / 1920.0, 495.0 / 1080.0),
    (1619.0 / 1920.0, 562.0 / 1080.0),
    (1628.0 / 1920.0, 630.0 / 1080.0),
    (1626.0 / 1920.0, 698.0 / 1080.0),
    (1627.0 / 1920.0, 766.0 / 1080.0),
];

#[cfg(target_os = "windows")]
fn set_difficulty(
    view: (i32, i32, i32, i32),
    slot: usize,
    difficulty: usize,
) -> Result<(), String> {
    let x = view.0 + (0.177 * view.2 as f64) as i32;
    let selector_y = view.1 + (SLOT_Y[slot - 1] * view.3 as f64) as i32;
    click(x, selector_y)?;
    thread::sleep(Duration::from_millis(600));
    click(
        x,
        view.1
            + ((SLOT_Y[slot - 1] + DIFF_OFFSETS[difficulty.min(3)]) * view.3 as f64) as i32,
    )?;
    thread::sleep(Duration::from_millis(400));
    Ok(())
}

#[cfg(target_os = "windows")]
fn pick_dropdown(
    view: (i32, i32, i32, i32),
    slot: usize,
    column: f64,
    item_index: usize,
) -> Result<(), String> {
    let visible_rows = usize::max(4, 9usize.saturating_sub(slot));
    let visible_items = visible_rows - 1;
    let x = view.0 + (column * view.2 as f64) as i32;
    let selector_y = view.1 + (SLOT_Y[slot - 1] * view.3 as f64) as i32;
    let list_top = SLOT_Y[slot - 1] + DROP_GAP;
    click(x, selector_y)?;
    thread::sleep(Duration::from_millis(600));
    let target_y = if item_index < visible_items {
        list_top + (item_index + 1) as f64 * DROP_STEP
    } else {
        move_mouse(x, selector_y + (0.05 * view.3 as f64) as i32)?;
        let notches = item_index - visible_items + 1;
        for _ in 0..notches {
            scroll(-1)?;
        }
        thread::sleep(Duration::from_millis(200));
        list_top + (visible_rows - 1) as f64 * DROP_STEP
    };
    click(x, view.1 + (target_y * view.3 as f64) as i32)?;
    thread::sleep(Duration::from_millis(400));
    Ok(())
}

#[cfg(target_os = "windows")]
fn color_index(value: &str) -> Option<usize> {
    [
        "blue",
        "red",
        "yellow",
        "green",
        "orange",
        "light_blue",
        "purple",
        "pink",
        "black",
        "white",
    ]
    .iter()
    .position(|item| *item == value)
}

#[cfg(target_os = "windows")]
fn player_template(faction_id: &str) -> Option<i32> {
    match faction_id {
        "men-of-the-west" | "men" => Some(3),
        "elves" => Some(5),
        "dwarves" => Some(6),
        "isengard" => Some(7),
        "mordor" => Some(8),
        "goblins" => Some(9),
        "angmar" => Some(10),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Start positions on the room minimap (defense/attack pools)
// ---------------------------------------------------------------------------

fn parse_start_positions(map: &Value) -> BTreeMap<u64, (f64, f64)> {
    let mut result = BTreeMap::new();
    let Some(entries) = map.get("startPositions").and_then(Value::as_object) else {
        return result;
    };
    for (slot, position) in entries {
        let Ok(slot) = slot.parse::<u64>() else { continue };
        let Some(x) = position.get("x").and_then(Value::as_f64) else { continue };
        let Some(y) = position.get("y").and_then(Value::as_f64) else { continue };
        if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y) {
            result.insert(slot, (x, y));
        }
    }
    result
}

/// Port of room.assign_start_positions: the fortress owner is clicked first
/// (slot_number clicks on the main defense point), then every other slot in
/// ascending order with a single click per point.
#[cfg(target_os = "windows")]
fn assign_start_positions(
    view: (i32, i32, i32, i32),
    positions: &BTreeMap<u64, (f64, f64)>,
    fortress_owner: Option<u64>,
    log: &AutomationLog,
) -> Result<(), String> {
    let owner = fortress_owner.filter(|slot| positions.contains_key(slot));
    if let Some(owner) = owner {
        let (x, y) = positions[&owner];
        log.write(format!("[room] стартовая позиция: слот {owner} (владелец крепости) → ({x:.4}, {y:.4}) — {owner} клик(ов)"));
        for _ in 0..owner {
            click_fraction(view, x, y)?;
            thread::sleep(START_POS_CLICK_GAP);
        }
        for (&slot, &(x, y)) in positions.iter().filter(|(slot, _)| **slot != owner) {
            log.write(format!("[room] стартовая позиция: слот {slot} → ({x:.4}, {y:.4})"));
            click_fraction(view, x, y)?;
            thread::sleep(START_POS_CLICK_GAP);
        }
        return Ok(());
    }
    for (&slot, &(x, y)) in positions.iter() {
        log.write(format!("[room] стартовая позиция: слот {slot} → ({x:.4}, {y:.4})"));
        click_fraction(view, x, y)?;
        thread::sleep(START_POS_CLICK_GAP);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// NetworkPref.ini (player faction/color/rules)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
struct NetworkPrefResult {
    paths: Vec<PathBuf>,
}

#[cfg(target_os = "windows")]
fn pref_line_has_key(line: &str, key: &str) -> bool {
    let line = line.trim().to_ascii_lowercase();
    let key = key.to_ascii_lowercase();
    line == key
        || line
            .strip_prefix(&key)
            .and_then(|tail| tail.chars().next())
            .is_some_and(|character| matches!(character, ' ' | '=' | '\t'))
}

#[cfg(target_os = "windows")]
fn registry_string(root: Handle, sub_key: &str, value_name: &str, view: u32) -> Option<String> {
    let sub_key = wide(sub_key);
    let value_name = wide(value_name);
    let mut key: Handle = null_mut();
    if unsafe { RegOpenKeyExW(root, sub_key.as_ptr(), 0, KEY_READ | view, &mut key) } != 0 {
        return None;
    }
    let mut value_type = 0u32;
    let mut size = 0u32;
    let first = unsafe {
        RegQueryValueExW(
            key,
            value_name.as_ptr(),
            null_mut(),
            &mut value_type,
            null_mut(),
            &mut size,
        )
    };
    if first != 0 || size < 2 {
        unsafe { RegCloseKey(key) };
        return None;
    }
    let mut buffer = vec![0u16; (size as usize + 1) / 2];
    let status = unsafe {
        RegQueryValueExW(
            key,
            value_name.as_ptr(),
            null_mut(),
            &mut value_type,
            buffer.as_mut_ptr() as *mut u8,
            &mut size,
        )
    };
    unsafe { RegCloseKey(key) };
    if status != 0 || !(value_type == 1 || value_type == 2) {
        return None;
    }
    let end = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    let value = String::from_utf16_lossy(&buffer[..end]).trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(target_os = "windows")]
fn network_pref_paths(
    _executable: &Path,
    real_appdata: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let mut appdata_roots = Vec::new();
    if let Some(path) = real_appdata.filter(|value| !value.trim().is_empty()) {
        appdata_roots.push(PathBuf::from(path))
    }
    if let Ok(path) = std::env::var("APPDATA") {
        let path = PathBuf::from(path);
        if !appdata_roots.iter().any(|item| item == &path) {
            appdata_roots.push(path)
        }
    }
    if appdata_roots.is_empty() {
        return Err("APPDATA is not set".into());
    }
    let appdata = appdata_roots[0].clone();
    let registry_key = r"SOFTWARE\Electronic Arts\Electronic Arts\The Lord of the Rings, The Rise of the Witch-king";
    let mut folders = Vec::new();
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            if let Some(leaf) = registry_string(root, registry_key, "UserDataLeafName", view) {
                for root in &appdata_roots {
                    folders.push(root.join(&leaf));
                }
            }
        }
    }
    // Different EA releases use both names below. Localized releases normally
    // expose the exact folder through UserDataLeafName, but existing folders
    // are also considered for broken/missing registry installations.
    let known = [
        "My Rise of the Witch-king Files",
        "My The Lord of the Rings, The Rise of the Witch-king Files",
    ];
    for root in &appdata_roots {
        for leaf in known {
            let folder = root.join(leaf);
            if folder.exists() {
                folders.push(folder)
            }
        }
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() || !path.join("NetworkPref.ini").is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_lowercase();
                let likely = [
                    "witch",
                    "roi-sorcier",
                    "roi sorcier",
                    "hexenk",
                    "rey brujo",
                    "re stregone",
                    "корол",
                    "czarownic",
                ]
                .iter()
                .any(|token| name.contains(token));
                if likely {
                    folders.push(path)
                }
            }
        }
    }
    if let Ok(users) = std::fs::read_dir(
        Path::new(&std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into())).join("Users"),
    ) {
        for user in users.flatten() {
            let roaming = user.path().join("AppData/Roaming");
            for leaf in known {
                let folder = roaming.join(leaf);
                if folder.join("NetworkPref.ini").is_file() || folder.join("Options.ini").is_file()
                {
                    folders.push(folder)
                }
            }
        }
    }
    if folders.is_empty() {
        folders.push(appdata.join("My Rise of the Witch-king Files"));
        folders.push(appdata.join("My The Lord of the Rings, The Rise of the Witch-king Files"));
    }
    let mut unique = Vec::new();
    for folder in folders {
        let normalized = folder.to_string_lossy().to_lowercase();
        if !unique
            .iter()
            .any(|existing: &PathBuf| existing.to_string_lossy().to_lowercase() == normalized)
        {
            unique.push(folder.join("NetworkPref.ini"));
        }
    }
    Ok(unique)
}

#[cfg(target_os = "windows")]
fn profile_folders(executable: &Path, real_appdata: Option<&str>) -> Vec<PathBuf> {
    network_pref_paths(executable, real_appdata)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.parent().map(Path::to_path_buf))
        .collect()
}

#[cfg(target_os = "windows")]
fn ini_line_has_key(line: &str, key: &str) -> bool {
    pref_line_has_key(line, key)
}

#[cfg(target_os = "windows")]
fn read_ini_option(folder: &Path, key: &str) -> Option<String> {
    let text = std::fs::read(folder.join("Options.ini")).ok()?;
    let text = String::from_utf8_lossy(&text);
    for line in text.lines() {
        if line.trim().is_empty() || !line.contains('=') {
            continue;
        }
        if ini_line_has_key(line, key) {
            return line.split_once('=').map(|(_, value)| value.trim().to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn set_ini_option(folder: &Path, key: &str, value: &str) -> Result<(), String> {
    let path = folder.join("Options.ini");
    let previous = std::fs::read(&path).unwrap_or_default();
    let text = String::from_utf8_lossy(&previous);
    let mut output: Vec<String> = Vec::new();
    let mut written = false;
    for line in text.lines() {
        if !written && ini_line_has_key(line, key) {
            output.push(format!("{key} = {value}"));
            written = true;
        } else {
            output.push(line.to_string());
        }
    }
    if !written {
        output.push(format!("{key} = {value}"));
    }
    let mut content = output.join("\n");
    content.push('\n');
    let bytes: Vec<u8> = content
        .chars()
        .map(|character| {
            if u32::from(character) <= 255 {
                character as u8
            } else {
                b'?'
            }
        })
        .collect();
    std::fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes).map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

#[cfg(target_os = "windows")]
fn write_network_pref(path: &Path, settings: &[(&str, String)]) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|error| format!("Failed to create {}: {error}", folder.display()))?
    }
    let previous = std::fs::read(path).unwrap_or_default();
    let text: String = previous.iter().map(|byte| char::from(*byte)).collect();
    let mut output = Vec::new();
    let mut written = vec![false; settings.len()];
    for line in text.lines() {
        let mut replacement = None;
        for (index, (key, value)) in settings.iter().enumerate() {
            if !written[index] && pref_line_has_key(line, key) {
                replacement = Some(format!("{key} = {value}"));
                written[index] = true;
                break;
            }
        }
        output.push(replacement.unwrap_or_else(|| line.to_string()));
    }
    for (index, (key, value)) in settings.iter().enumerate() {
        if !written[index] {
            output.push(format!("{key} = {value}"));
        }
    }
    let content = format!("{}\n", output.join("\n"));
    let bytes: Vec<u8> = content
        .chars()
        .map(|character| {
            if u32::from(character) <= 255 {
                character as u8
            } else {
                b'?'
            }
        })
        .collect();
    std::fs::write(path, bytes)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

#[cfg(target_os = "windows")]
fn update_network_pref(executable: &Path, config: &Value) -> Result<NetworkPrefResult, String> {
    let mut settings: Vec<(&str, String)> = Vec::new();
    if let Some(rules) = config.get("networkRules").and_then(Value::as_str) {
        settings.push(("Rts:Rules", rules.trim().to_string()));
    }
    let player = config
        .get("participants")
        .and_then(Value::as_array)
        .and_then(|participants| participants.first());
    let template = player
        .and_then(|value| value.get("factionId"))
        .and_then(Value::as_str)
        .and_then(player_template);
    if let Some(value) = template {
        settings.push(("Rts:PlayerTemplate", value.to_string()));
    }
    let color = player
        .and_then(|value| value.get("color"))
        .and_then(Value::as_str)
        .and_then(color_index);
    if let Some(value) = color {
        settings.push(("Rts:Color", value.to_string()));
    }
    let candidates = network_pref_paths(
        executable,
        config.get("_realAppData").and_then(Value::as_str),
    )?;
    let mut written_paths = Vec::new();
    let mut errors = Vec::new();
    for path in candidates {
        match write_network_pref(&path, &settings) {
            Ok(()) => {
                println!("[BFME] NetworkPref.ini -> {}", path.display());
                written_paths.push(path)
            }
            Err(error) => errors.push(error),
        }
    }
    if written_paths.is_empty() {
        return Err(errors
            .into_iter()
            .next()
            .unwrap_or_else(|| "Failed to locate NetworkPref.ini".to_string()));
    }
    for error in errors {
        eprintln!("[BFME] NetworkPref warning: {error}")
    }
    Ok(NetworkPrefResult {
        paths: written_paths,
    })
}

// ---------------------------------------------------------------------------
// Launch helpers (windowed mode for calibration / coordinate tests)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn launch_game(executable: &Path, windowed: bool, resolution: Option<&str>, log: &AutomationLog) -> Result<(), String> {
    let mut restored = false;
    let mut old_resolution: Option<(PathBuf, String)> = None;
    if windowed {
        let target = resolution.unwrap_or(CALIBRATION_RESOLUTION);
        for folder in profile_folders(executable, std::env::var("APPDATA").ok().as_deref()) {
            match read_ini_option(&folder, "Resolution") {
                Some(current) => {
                    if current != target {
                        old_resolution = Some((folder.clone(), current));
                        let _ = set_ini_option(&folder, "Resolution", target);
                    }
                }
                // Options.ini may not exist yet on a fresh profile — create the
                // key so the game still starts in a small window.
                None => {
                    let _ = set_ini_option(&folder, "Resolution", target);
                }
            }
        }
        log.write(format!("[launch] оконный режим {target} (прежнее разрешение: {:?})", old_resolution.as_ref().map(|(_, value)| value)));
    }
    Command::new(executable)
        .current_dir(executable.parent().ok_or("Не найдена папка игры")?)
        .args(if windowed { vec!["-win"] } else { Vec::<&str>::new() })
        .spawn()
        .map_err(|error| format!("Не удалось запустить BFME: {error}"))?;
    if windowed {
        // The game reads Options.ini at startup; restore the user value afterwards.
        thread::sleep(CALIBRATION_RESTORE_AFTER);
        if let Some((folder, value)) = old_resolution {
            let _ = set_ini_option(&folder, "Resolution", &value);
            restored = true;
        }
    }
    if restored {
        log.write("[launch] прежнее разрешение восстановлено в Options.ini");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Main automation flow (battle config v2)
// ---------------------------------------------------------------------------

pub enum FlowOutcome {
    /// Full battle was started; the monitor phase may follow.
    BattleLaunched,
    /// Coordinate test finished in the room; the game stays open for inspection.
    CoordinatesTested,
}

#[cfg(target_os = "windows")]
fn launch_and_configure_inner(executable: &Path, config: &Value, log: &AutomationLog) -> Result<FlowOutcome, String> {
    let language = config
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("ru");
    if !AUTOMATION_BUSY.swap(true, Ordering::SeqCst) {
        struct BusyGuard;
        impl Drop for BusyGuard {
            fn drop(&mut self) {
                AUTOMATION_BUSY.store(false, Ordering::SeqCst);
            }
        }
        let _busy = BusyGuard;
        if game_process_is_running() {
            log.write("[check] игра уже запущена — закрываю перед новым запуском");
            stop_game();
        } else {
            log.write("[check] игра не запущена");
        }
        let _input_lock = InputLockGuard::acquire()?;
        let pref_result = update_network_pref(executable, config)?;
        log.write(format!(
            "[prefs] NetworkPref.ini prepared in {} profile folder(s)",
            pref_result.paths.len()
        ));
        let windowed = config
            .get("launch")
            .and_then(|value| value.get("windowed"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let resolution = config
            .get("launch")
            .and_then(|value| value.get("resolution"))
            .and_then(Value::as_str);
        log.write(if windowed { "[launch] starting BFME (windowed)" } else { "[launch] starting BFME" });
        launch_game(executable, windowed, resolution, log)?;

        log.write("[wait] waiting for the game.dat window (up to 120s)");
        let (window, discovery) = wait_for_game_window(Duration::from_secs(120))?;
        log.write(format!("[window] found via {discovery}"));
        unsafe {
            SetForegroundWindow(window);
        }
        wait_for_menu_ready(window, log, language)?;
        let view = viewport(window)?;
        unsafe {
            SetForegroundWindow(window);
        }

        log.write("[nav] Network -> Local Network -> Create Game");
        move_mouse(
            view.0 + (0.3019 * view.2 as f64) as i32,
            view.1 + (0.9244 * view.3 as f64) as i32,
        )?;
        thread::sleep(Duration::from_millis(800));
        click_fraction(view, 0.3000, 0.7811)?;
        thread::sleep(Duration::from_secs(2));
        click_fraction(view, 0.8337, 0.4611)?;
        thread::sleep(Duration::from_secs(2));

        let participants = config
            .get("participants")
            .and_then(Value::as_array)
            .ok_or("В battle_config отсутствуют участники")?;
        if participants.is_empty() || participants.len() > 8 {
            return Err("BFME поддерживает от 1 до 8 RTS-слотов".into());
        }
        let test_mode = config
            .get("testCoordinates")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let difficulty = config
            .get("difficulty")
            .and_then(|value| value.get("bfmeIndex"))
            .and_then(Value::as_u64)
            .unwrap_or(1) as usize;

        log.write(format!(
            "[room] configuring {} RTS slots{}",
            participants.len(),
            if test_mode { " (тест координат)" } else { "" }
        ));
        // Проверенный порядок Python PoC: сложность -> фракции -> союзы -> цвета.
        if test_mode {
            // Тест координат: только сложность «Новобранец», фракции/союзы/цвета не трогаем.
            for slot in 2..=8 {
                set_difficulty(view, slot, 0)?;
            }
        } else {
            for slot in 2..=participants.len() {
                set_difficulty(view, slot, difficulty)?;
            }
            // Фракция и цвет игрока уже заданы через NetworkPref.ini. В комнате
            // меняем только ботов, чтобы не создавать лишние клики по первому слоту.
            for (index, participant) in participants.iter().enumerate().skip(1) {
                let list_index = participant
                    .get("listIndex")
                    .and_then(Value::as_u64)
                    .ok_or("Нет индекса фракции BFME")? as usize;
                pick_dropdown(view, index + 1, 0.383, list_index)?;
            }
            for (index, participant) in participants.iter().enumerate() {
                let alliance = if participant.get("side").and_then(Value::as_str) == Some("evil") {
                    1
                } else {
                    0
                };
                pick_dropdown(view, index + 1, 0.685, alliance)?;
            }

            let player_color = participants[0]
                .get("color")
                .and_then(Value::as_str)
                .and_then(color_index)
                .unwrap_or(0);
            let mut used_colors = vec![player_color];
            for (index, participant) in participants.iter().enumerate().skip(1) {
                let Some(color) = participant
                    .get("color")
                    .and_then(Value::as_str)
                    .and_then(color_index)
                else {
                    continue;
                };
                if used_colors.contains(&color) {
                    continue;
                }
                let adjusted = color - usize::from(color > player_color);
                pick_dropdown(view, index + 1, 0.744, adjusted)?;
                used_colors.push(color);
            }
        }

        // Стартовые позиции на миникарте: защиты/атаки пул + владелец крепости.
        if let Some(map) = config.get("map") {
            let positions = parse_start_positions(map);
            if !positions.is_empty() {
                let fortress_owner = map.get("fortressOwnerSlot").and_then(Value::as_u64);
                assign_start_positions(view, &positions, fortress_owner, log)?;
            } else if !test_mode {
                log.write("[room] стартовые позиции не заданы — слоты остаются на случайных местах");
            }
        }

        if test_mode {
            log.write("[test] координаты выставлены; расстановка завершена — автоматизация остановлена");
            return Ok(FlowOutcome::CoordinatesTested);
        }

        log.write("[room] clicking Start Game");
        click_fraction(view, 0.8836, 0.9542)?;
        thread::sleep(START_COUNTDOWN);
        log.write("[done] battle launched");
        return Ok(FlowOutcome::BattleLaunched);
    }
    Err("Автоматизация BFME уже выполняется".into())
}

#[cfg(target_os = "windows")]
pub fn launch_and_configure(executable: &Path, config: &Value) -> Result<(), String> {
    let log = AutomationLog::start();
    launch_and_configure_inner(executable, config, &log).map(|_| ())
}

#[cfg(not(target_os = "windows"))]
pub fn launch_and_configure(_executable: &Path, _config: &Value) -> Result<(), String> {
    Err("Автоматизация BFME поддерживается только в Windows".into())
}

// ---------------------------------------------------------------------------
// Match result monitoring (ported from match_result_detector)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn players_from_config(config: &Value) -> Vec<PlayerInfo> {
    config
        .get("participants")
        .and_then(Value::as_array)
        .map(|participants| {
            participants
                .iter()
                .filter_map(|participant| {
                    let slot = participant.get("slot").and_then(Value::as_u64)?;
                    let color = participant
                        .get("color")
                        .and_then(Value::as_str)
                        .unwrap_or("blue")
                        .to_string();
                    let side = match participant.get("side").and_then(Value::as_str) {
                        Some("evil") => "evil".to_string(),
                        _ => "good".to_string(),
                    };
                    Some(PlayerInfo { slot, color, side })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn capture_game_frame() -> Option<RgbFrame> {
    let (window, _) = find_game_window()?;
    let view = viewport(window).ok()?;
    capture_viewport(view).ok()
}

/// Wait for the score screen, analyse the winner, and report the result JSON.
#[cfg(target_os = "windows")]
fn monitor_battle(config: &Value, log: &AutomationLog) -> Value {
    let started = Instant::now();
    let players = players_from_config(config);
    if players.is_empty() {
        return json!({"status":"UNKNOWN","winningTeam":null,"winningSlot":null,"detail":"participants are missing","elapsedSec":0});
    }
    let timeout = config
        .get("monitor")
        .and_then(|value| value.get("timeoutSec"))
        .and_then(Value::as_u64)
        .map(Duration::from_secs)
        .unwrap_or(MONITOR_DEFAULT_TIMEOUT);
    let fortress = match_detector::fortress_template();
    let marker = match_detector::score_marker_template();

    log.write(format!(
        "[match] жду экран статистики (до {} c)…",
        timeout.as_secs()
    ));
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            return json!({"status":"UNKNOWN","winningTeam":null,"winningSlot":null,"detail":"score screen timeout","elapsedSec":started.elapsed().as_secs()});
        }
        if !game_process_is_running() {
            return json!({"status":"UNKNOWN","winningTeam":null,"winningSlot":null,"detail":"игра закрыта до появления экрана статистики","elapsedSec":started.elapsed().as_secs()});
        }
        if let Some(frame) = capture_game_frame() {
            if !frame.is_black() && is_score_screen(&frame, &fortress, &marker) {
                log.write("[match] экран статистики найден — анализирую победителя");
                let mut result = analyse_score_screen(&players, log);
                if let Some(object) = result.as_object_mut() {
                    object.insert("elapsedSec".into(), json!(started.elapsed().as_secs()));
                }
                return result;
            }
        }
        thread::sleep(SCORE_SCREEN_POLL);
    }
}

#[cfg(target_os = "windows")]
fn analyse_score_screen(players: &[PlayerInfo], log: &AutomationLog) -> Value {
    let _input_lock = InputLockGuard::acquire();
    let fortress = match_detector::fortress_template();
    let marker = match_detector::score_marker_template();
    let view = find_game_window().and_then(|(window, _)| viewport(window).ok());
    if let Some(view) = view {
        // «Пропустить» ускоряет появление вкладок, затем открываем вкладку «Счёт».
        let _ = click_fraction(view, SKIP_BUTTON_FRAC.0, SKIP_BUTTON_FRAC.1);
        thread::sleep(TAB_SETTLE);
        let tab_x = (SCORE_TAB_ROI.0 + SCORE_TAB_ROI.2) / 2.0;
        let tab_y = (SCORE_TAB_ROI.1 + SCORE_TAB_ROI.3) / 2.0;
        let _ = click_fraction(view, tab_x, tab_y);
        thread::sleep(TAB_SETTLE);
        let _ = click_fraction(view, tab_x, tab_y);
        thread::sleep(TAB_SETTLE);
    }
    // Ждём стабильный кадр графика (не чёрный, подтверждён маркерами статистики).
    let mut frame: Option<RgbFrame> = None;
    let deadline = Instant::now() + ANALYSIS_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(candidate) = capture_game_frame() {
            if !candidate.is_black() && is_score_screen(&candidate, &fortress, &marker) {
                frame = Some(candidate);
                break;
            }
        }
        thread::sleep(RETRY_DELAY);
    }
    let Some(frame) = frame else {
        return json!({"status":"UNKNOWN","winningTeam":null,"winningSlot":null,"detail":"no valid chart frame"});
    };
    let icons = detect_icons(&frame);
    if icons.is_empty() {
        return json!({"status":"UNKNOWN","winningTeam":null,"winningSlot":null,"detail":"victory/defeat icons not found"});
    }
    log.write(format!("[match] найдено иконок: {}", icons.len()));

    let max_x_gap = 80.0f64;
    let max_y_gap = 60.0f64;
    let mut slots: Vec<u64> = players.iter().map(|player| player.slot).collect();
    slots.sort_unstable();
    slots.dedup();

    let mut surrendered_slot: Option<u64> = None;
    for slot in slots {
        let Some(player) = players.iter().find(|item| item.slot == slot) else { continue };
        if slot > 1 {
            if let Some(view) = view {
                if slot >= 2 && (slot as usize) <= RATING_SLOT_FRAC.len() + 1 {
                    let (fx, fy) = RATING_SLOT_FRAC[(slot - 2) as usize];
                    if click_fraction(view, fx, fy).is_err() {
                        log.write(format!("[match] не удалось кликнуть слот {slot} рейтинга"));
                    }
                    thread::sleep(SLOT_SETTLE);
                }
            }
        }
        let current = capture_game_frame().unwrap_or_else(|| frame.clone());
        let Some((x_end, y_end)) = line_endpoint(&current, &player.color, &icons, true) else {
            log.write(format!("[match] слот {slot} ({}): яркая линия не найдена — сдача", player.color));
            surrendered_slot = Some(slot);
            break;
        };
        let mut candidates: Vec<&match_detector::DetectedIcon> = icons
            .iter()
            .filter(|icon| {
                (icon.x - x_end).abs() <= max_x_gap && (icon.y - y_end).abs() <= max_y_gap
            })
            .collect();
        candidates.sort_by(|left, right| {
            let dl = (left.x - x_end).hypot(left.y - y_end);
            let dr = (right.x - x_end).hypot(right.y - y_end);
            dl.partial_cmp(&dr).unwrap_or(std::cmp::Ordering::Equal)
        });
        match candidates.first() {
            Some(icon) if icon.kind == "victory" => {
                log.write(format!("[match] слот {slot} ({}): линия дошла до монеты победы", player.color));
                return json!({
                    "status":"COMPLETED",
                    "winningTeam":player.side,
                    "winningSlot":slot,
                    "detail":format!("slot {} ({}) reached the victory coin", slot, player.color)
                });
            }
            Some(_) => {
                log.write(format!("[match] слот {slot} ({}): иконка поражения — проверяю следующий слот", player.color));
            }
            None => {
                surrendered_slot = Some(slot);
                break;
            }
        }
    }
    if let Some(slot) = surrendered_slot {
        if let Some(player) = players.iter().find(|item| item.slot == slot) {
            let winner = players.iter().find(|item| item.side != player.side);
            return json!({
                "status":"SURRENDER",
                "winningTeam":winner.map(|item| item.side.clone()),
                "winningSlot":null,
                "detail":format!("slot {} ({}) surrendered or left the match", slot, player.color)
            });
        }
    }
    json!({"status":"UNKNOWN","winningTeam":null,"winningSlot":null,"detail":"no conclusive victory icon"})
}

/// Monitor the battle after launch, persist the result, then close the game.
#[cfg(target_os = "windows")]
pub fn monitor_and_finish(config: &Value, result_path: &Path, log: &AutomationLog) {
    let result = monitor_battle(config, log);
    log.write(format!(
        "[match] результат: status={} winningTeam={}",
        result.get("status").and_then(Value::as_str).unwrap_or("?"),
        result
            .get("winningTeam")
            .and_then(Value::as_str)
            .unwrap_or("?")
    ));
    if let Some(parent) = result_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut payload = result;
    if let Some(object) = payload.as_object_mut() {
        object.insert("finishedAt".into(), json!(crate::unix_timestamp()));
    }
    if let Ok(text) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(result_path, text);
    }
    log.write("[match] закрываю BFME после определения победителя");
    stop_game();
}

#[cfg(target_os = "windows")]
fn monitor_requested(config: &Value) -> bool {
    config
        .get("monitor")
        .and_then(|value| value.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn battle_result_path_from(config: &Value, fallback: &Path) -> PathBuf {
    config
        .get("_battleResultPath")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback.to_path_buf())
}

// ---------------------------------------------------------------------------
// Deployment planning + execution
// ---------------------------------------------------------------------------

fn deployment_error(language: &str, action: &str, path: &Path, error: &std::io::Error) -> String {
    if language == "en" {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            return format!(
                "Access denied while {action} {}. Confirm the Windows UAC prompt and try again.",
                path.display()
            );
        }
        format!("Failed while {action} {}: {error}", path.display())
    } else if error.kind() == std::io::ErrorKind::PermissionDenied {
        format!(
            "Доступ запрещён при записи {}. Подтвердите запрос Windows UAC и повторите попытку.",
            path.display()
        )
    } else {
        let action_ru = match action {
            "reading" => "чтение",
            "creating the game folder" => "создание папки игры",
            "copying" => "копирование",
            "replacing" => "замена",
            "installing" => "установка",
            "verifying" => "проверка",
            "removing obsolete WOTR files" => "удаление устаревших файлов WOTR",
            _ => action,
        };
        format!(
            "Не удалось выполнить операцию «{action_ru}» для {}: {error}",
            path.display()
        )
    }
}

fn deploy_job_files(deployment: &Value, language: &str) -> Result<Vec<Value>, String> {
    let Some(entries) = deployment.as_array() else { return Ok(Vec::new()); };
    // Remove obsolete bundled WOTR archives from the external game folder.
    // A filename explicitly supplied by the active mod is never removed.
    let destinations: Vec<PathBuf> = entries.iter().filter_map(|entry| entry.get("destinationPath").and_then(Value::as_str).map(PathBuf::from)).collect();
    if let Some(game_dir) = destinations.first().and_then(|path| path.parent()) {
        for legacy in ["__wotr_ini.big", "__wotr_maps.big", "__wotr_maps_cache.big", "wotr_generated_presets.big", "__wotr_generated_presets.big"] {
            let path = game_dir.join(legacy);
            let supplied = destinations.iter().any(|destination| destination.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case(legacy)));
            if path.exists() && !supplied {
                std::fs::remove_file(&path).map_err(|error| deployment_error(language, "removing obsolete WOTR files", &path, &error))?;
            }
        }
    }
    let mut deployed = Vec::new();
    for entry in entries {
        let source = entry
            .get("sourcePath")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| {
                if language == "en" {
                    "Deployment source path is missing".to_string()
                } else {
                    "Не указан исходный путь файла развёртывания".to_string()
                }
            })?;
        let destination = entry
            .get("destinationPath")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| {
                if language == "en" {
                    "Deployment destination path is missing".to_string()
                } else {
                    "Не указан целевой путь файла развёртывания".to_string()
                }
            })?;
        let expected = entry
            .get("expectedSize")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let always_replace = entry
            .get("alwaysReplace")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !source.is_file() {
            return Err(if language == "en" {
                format!("Source BIG file is missing: {}", source.display())
            } else {
                format!("Исходный BIG-файл отсутствует: {}", source.display())
            });
        }
        let source_size = std::fs::metadata(&source)
            .map_err(|error| deployment_error(language, "reading", &source, &error))?
            .len();
        if expected > 0 && source_size != expected {
            return Err(if language == "en" {
                format!(
                    "Resource size mismatch for {}: expected {expected}, found {source_size}",
                    source.display()
                )
            } else {
                format!(
                    "Размер ресурса {} изменён: ожидалось {expected}, найдено {source_size}",
                    source.display()
                )
            });
        }
        let existing = std::fs::metadata(&destination)
            .ok()
            .map(|metadata| metadata.len());
        let action = if !always_replace && existing == Some(source_size) {
            "kept"
        } else {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    deployment_error(language, "creating the game folder", parent, &error)
                })?;
            }
            let temporary = destination.with_extension("wotr-tmp");
            std::fs::copy(&source, &temporary)
                .map_err(|error| deployment_error(language, "copying", &destination, &error))?;
            if destination.exists() {
                std::fs::remove_file(&destination).map_err(|error| {
                    deployment_error(language, "replacing", &destination, &error)
                })?;
            }
            std::fs::rename(&temporary, &destination)
                .map_err(|error| deployment_error(language, "installing", &destination, &error))?;
            if existing.is_some() {
                "replaced"
            } else {
                "copied"
            }
        };
        let actual = std::fs::metadata(&destination)
            .map_err(|error| deployment_error(language, "verifying", &destination, &error))?
            .len();
        deployed.push(json!({
            "name": destination.file_name().and_then(|value| value.to_str()).unwrap_or(""),
            "expectedSize": source_size,
            "actualSize": actual,
            "action": action,
        }));
    }
    Ok(deployed)
}

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn is_elevated() -> bool {
    unsafe { IsUserAnAdmin() != 0 }
}

#[cfg(target_os = "windows")]
fn run_elevated_helper(job_path: &Path, result_path: &Path) -> Result<Vec<Value>, String> {
    let helper = std::env::current_exe()
        .map_err(|error| format!("Не удалось определить EXE WOTR: {error}"))?;
    let verb = wide("runas");
    let file = wide(&helper.to_string_lossy());
    // Символ двойной кавычки недопустим в пути Windows, поэтому такое
    // экранирование однозначно даже для каталогов с пробелами.
    let arguments = format!(
        "--wotr-rts-helper \"{}\" \"{}\"",
        job_path.display(),
        result_path.display()
    );
    let parameters = wide(&arguments);
    let directory_path = helper.parent().unwrap_or_else(|| Path::new("."));
    let directory = wide(&directory_path.to_string_lossy());
    let mut info = ShellExecuteInfoW {
        size: size_of::<ShellExecuteInfoW>() as u32,
        mask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI,
        window: null_mut(),
        verb: verb.as_ptr(),
        file: file.as_ptr(),
        parameters: parameters.as_ptr(),
        directory: directory.as_ptr(),
        show: 0,
        instance: null_mut(),
        id_list: null_mut(),
        class: null(),
        class_key: null_mut(),
        hot_key: 0,
        icon_or_monitor: null_mut(),
        process: null_mut(),
    };
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let error = last_error();
        return Err(if error == 1223 {
            "Запуск автоматизации отменён в окне контроля учётных записей Windows (UAC).".into()
        } else {
            format!(
                "Не удалось запустить автоматизацию от имени администратора: Windows error {error}"
            )
        });
    }
    if info.process.is_null() {
        return Err("Windows не вернул процесс elevated-автоматизации".into());
    }
    // The helper keeps running through the battle monitor phase, so the result
    // file is polled instead of waiting for process exit. The handle is only
    // used to detect an early crash.
    let process = info.process;
    let deployed = (|| -> Result<Vec<Value>, String> {
        let deadline = Instant::now() + HELPER_RESULT_TIMEOUT;
        while Instant::now() < deadline {
            if result_path.exists() {
                let result_text = std::fs::read_to_string(result_path)
                    .map_err(|error| format!("Elevated-автоматизация не вернула результат: {error}"))?;
                let result: Value = serde_json::from_str(&result_text)
                    .map_err(|error| format!("Повреждён ответ elevated-автоматизации: {error}"))?;
                if result.get("ok").and_then(Value::as_bool) == Some(true) {
                    return Ok(result
                        .get("deployed")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default());
                }
                return Err(result
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Автоматизация BFME завершилась с неизвестной ошибкой")
                    .to_string());
            }
            let mut exit_code = 0u32;
            unsafe {
                if GetExitCodeProcess(process, &mut exit_code) != 0 && exit_code != STILL_ACTIVE {
                    return Err(
                        "Elevated-автоматизация завершилась до отчёта (сбой или закрытие UAC-процесса)."
                            .into(),
                    );
                }
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err("Elevated-автоматизация не отчиталась за отведённое время".into())
    })();
    unsafe {
        CloseHandle(process);
    }
    deployed
}

#[cfg(target_os = "windows")]
pub fn deploy_and_launch_with_elevation(
    executable: &Path,
    config: &Value,
    temp_directory: &Path,
    deployment: &Value,
) -> Result<Vec<Value>, String> {
    let language = config
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("ru");
    if is_elevated() {
        let log = AutomationLog::start();
        let deployed = deploy_job_files(deployment, language)?;
        let outcome = launch_and_configure_inner(executable, config, &log)?;
        if matches!(outcome, FlowOutcome::BattleLaunched) && monitor_requested(config) {
            // Продолжаем мониторинг в фоне, чтобы не блокировать интерфейс.
            let monitor_config = config.clone();
            let result_path =
                battle_result_path_from(config, &temp_directory.join("rts_battle_result_last.json"));
            thread::Builder::new()
                .name("bfme-match-monitor".into())
                .spawn(move || {
                    let log = AutomationLog::start();
                    monitor_and_finish(&monitor_config, &result_path, &log);
                })
                .map_err(|error| format!("Не удалось запустить монитор боя: {error}"))?;
        }
        return Ok(deployed);
    }
    std::fs::create_dir_all(temp_directory).map_err(|error| error.to_string())?;
    let job_path = temp_directory.join("rts_automation_job.json");
    let result_path = temp_directory.join("rts_automation_result.json");
    let _ = std::fs::remove_file(&result_path);
    // The helper keeps this field so its monitor phase writes the outcome
    // exactly where the UI polls it.
    let job_config = config.clone();
    let job = json!({
        "executablePath": executable.to_string_lossy(),
        "battleConfig": job_config,
        "deployment": deployment,
    });
    std::fs::write(
        &job_path,
        serde_json::to_vec_pretty(&job).map_err(|error| error.to_string())?,
    )
    .map_err(|error| {
        if language == "en" {
            format!("Failed to write the automation job: {error}")
        } else {
            format!("Не удалось записать задание автоматизации: {error}")
        }
    })?;
    run_elevated_helper(&job_path, &result_path)
}

#[cfg(target_os = "windows")]
pub fn launch_with_elevation(
    executable: &Path,
    config: &Value,
    temp_directory: &Path,
) -> Result<(), String> {
    deploy_and_launch_with_elevation(executable, config, temp_directory, &json!([])).map(|_| ())
}

#[cfg(not(target_os = "windows"))]
pub fn deploy_and_launch_with_elevation(
    _executable: &Path,
    _config: &Value,
    _temp_directory: &Path,
    _deployment: &Value,
) -> Result<Vec<Value>, String> {
    Err("Автоматизация BFME поддерживается только в Windows".into())
}

#[cfg(not(target_os = "windows"))]
pub fn launch_with_elevation(
    _executable: &Path,
    _config: &Value,
    _temp_directory: &Path,
) -> Result<(), String> {
    Err("Автоматизация BFME поддерживается только в Windows".into())
}

#[cfg(target_os = "windows")]
fn helper_arguments() -> Option<(PathBuf, PathBuf)> {
    let arguments: Vec<OsString> = std::env::args_os().collect();
    if arguments.get(1).and_then(|value| value.to_str()) != Some("--wotr-rts-helper") {
        return None;
    }
    let job_path = arguments.get(2).map(PathBuf::from)?;
    let result_path = arguments.get(3).map(PathBuf::from)?;
    Some((job_path, result_path))
}

#[cfg(target_os = "windows")]
pub fn run_helper_if_requested() -> bool {
    let Some((job_path, result_path)) = helper_arguments() else {
        return false;
    };
    let result = (|| -> Result<(Vec<Value>, Option<Value>), String> {
        let job_text = std::fs::read_to_string(&job_path).map_err(|error| {
            format!(
                "Failed to read automation job {}: {error}",
                job_path.display()
            )
        })?;
        let job: Value = serde_json::from_str(&job_text)
            .map_err(|error| format!("Automation job is corrupted: {error}"))?;
        let executable = job
            .get("executablePath")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or("BFME path is missing from the automation job")?;
        let config = job
            .get("battleConfig")
            .ok_or("battleConfig is missing from the automation job")?
            .clone();
        let language = config
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or("ru");
        let deployed = deploy_job_files(job.get("deployment").unwrap_or(&Value::Null), language)?;
        let log = AutomationLog::start();
        let outcome = launch_and_configure_inner(&executable, &config, &log)?;
        if matches!(outcome, FlowOutcome::BattleLaunched) && monitor_requested(&config) {
            // Мониторинг боя продолжается ПОСЛЕ записи результата навигации:
            // главный процесс уже разблокирован и ждёт файл исхода боя.
            return Ok((deployed, Some(config)));
        }
        Ok((deployed, None))
    })();
    let (response, monitor_config) = match result {
        Ok((deployed, monitor_config)) => (json!({ "ok": true, "deployed": deployed }), monitor_config),
        Err(error) => (json!({ "ok": false, "error": error }), None),
    };
    if let Some(parent) = result_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &result_path,
        serde_json::to_vec_pretty(&response)
            .unwrap_or_else(|_| b"{\"ok\":false,\"error\":\"serialization failed\"}".to_vec()),
    );
    if let Some(config) = monitor_config {
        let fallback = result_path
            .parent()
            .map(|parent| parent.join("rts_battle_result_last.json"))
            .unwrap_or_else(|| PathBuf::from("rts_battle_result_last.json"));
        let path = battle_result_path_from(&config, &fallback);
        let log = AutomationLog::start();
        monitor_and_finish(&config, &path, &log);
    }
    true
}

#[cfg(not(target_os = "windows"))]
pub fn run_helper_if_requested() -> bool {
    false
}

// ---------------------------------------------------------------------------
// Coordinate calibration wizard (editor tool)
// ---------------------------------------------------------------------------

fn calibration_step_label(index: usize, is_fortress: bool) -> Value {
    if index >= 4 {
        json!({"index": index, "role": "attack", "main": false})
    } else {
        json!({"index": index, "role": "defense", "main": is_fortress && index == 0})
    }
}

#[cfg(target_os = "windows")]
fn set_calibration_topmost(app: &AppHandle, topmost: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(topmost);
    }
}

#[cfg(target_os = "windows")]
fn emit_calibration(app: &AppHandle, payload: Value) {
    let _ = app.emit(CALIBRATION_EVENT, payload);
}

/// Run the interactive 8-point calibration session (like tools/calibrate.py):
/// launch the game in a small window (or attach), then follow F9/F10 hotkeys.
#[cfg(target_os = "windows")]
pub fn run_calibration_session(app: AppHandle, executable: &Path, options: &Value) {
    let log = AutomationLog::start();
    let is_fortress = options
        .get("isFortress")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let attach = options
        .get("attach")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let resolution = options
        .get("resolution")
        .and_then(Value::as_str)
        .unwrap_or(CALIBRATION_RESOLUTION);
    set_calibration_topmost(&app, true);
    let finish = |payload: Value| {
        set_calibration_topmost(&app, false);
        CALIBRATION_ACTIVE.store(false, Ordering::SeqCst);
        emit_calibration(&app, payload);
    };
    if CALIBRATION_ACTIVE.swap(true, Ordering::SeqCst) {
        finish(json!({"type":"error","message":"Калибровка уже выполняется".to_string()}));
        return;
    }
    let receiver = match ensure_calibration_hook() {
        Ok(receiver) => receiver,
        Err(error) => {
            CALIBRATION_ACTIVE.store(false, Ordering::SeqCst);
            finish(json!({"type":"error","message":error}));
            return;
        }
    };
    if !attach && !game_process_is_running() {
        log.write("[cal] запускаю игру в оконном режиме для калибровки");
        if let Err(error) = launch_game(executable, true, Some(resolution), &log) {
            finish(json!({"type":"error","message":error}));
            return;
        }
    }
    let mut window = None;
    let window_deadline = Instant::now() + Duration::from_secs(120);
    while window.is_none() {
        if !CALIBRATION_ACTIVE.load(Ordering::Relaxed) {
            log.write("[cal] остановлено из редактора до появления окна");
            finish(json!({"type":"stopped","points":[]}));
            return;
        }
        window = find_game_window().map(|(handle, _)| handle);
        if window.is_none() {
            thread::sleep(Duration::from_millis(250));
            if Instant::now() > window_deadline {
                finish(json!({"type":"error","message":"Окно игры не появилось за 120 секунд".to_string()}));
                return;
            }
        }
    }
    let Some(window) = window else { unreachable!() };
    let mut steps = Vec::new();
    for index in 0..8 {
        steps.push(calibration_step_label(index, is_fortress));
    }
    emit_calibration(
        &app,
        json!({"type":"started","isFortress":is_fortress,"steps":steps,"resolution":resolution}),
    );
    log.write(if is_fortress {
        "[cal] шаг 1/8: ГЛАВНАЯ позиция защиты (владелец крепости) — наведите курсор и нажмите F9"
    } else {
        "[cal] шаг 1/8: 1-я позиция ЗАЩИТЫ — наведите курсор и нажмите F9"
    });

    let mut captured: Vec<(f64, f64)> = Vec::new();
    let mut last_key = Instant::now() - Duration::from_secs(10);
    loop {
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(VK_QUIT) => {
                log.write("[cal] остановлено пользователем (F10)");
                finish(json!({"type":"stopped","points":captured}));
                return;
            }
            Ok(VK_CAPTURE) => {
                if last_key.elapsed() < Duration::from_millis(400) {
                    continue; // защита от автоповтора клавиши
                }
                last_key = Instant::now();
                let view = match viewport(window) {
                    Ok(view) => view,
                    Err(error) => {
                        emit_calibration(&app, json!({"type":"error","message":format!("Окно игры недоступно: {error}")}));
                        continue;
                    }
                };
                let Some((cursor_x, cursor_y)) = cursor_position() else {
                    continue;
                };
                let fx = f64::from(cursor_x - view.0) / f64::from(view.2);
                let fy = f64::from(cursor_y - view.1) / f64::from(view.3);
                if !(0.0..=1.0).contains(&fx) || !(0.0..=1.0).contains(&fy) {
                    emit_calibration(
                        &app,
                        json!({"type":"error","message":"Курсор вне окна игры — наведите точку на миникарте комнаты BFME."}),
                    );
                    continue;
                }
                let index = captured.len();
                captured.push(((fx * 10000.0).round() / 10000.0, (fy * 10000.0).round() / 10000.0));
                let (x, y) = captured[index];
                log.write(format!("[cal] точка {} из 8: frac=({x:.4}, {y:.4})", index + 1));
                if captured.len() >= 8 {
                    let defense: Vec<Value> = captured[0..4].iter().map(|(x, y)| json!({"x":x,"y":y})).collect();
                    let attack: Vec<Value> = captured[4..8].iter().map(|(x, y)| json!({"x":x,"y":y})).collect();
                    log.write("[cal] все 8 точек сняты — калибровка завершена");
                    finish(json!({"type":"finished","defense":defense,"attack":attack}));
                    return;
                }
                let next = calibration_step_label(index + 1, is_fortress);
                emit_calibration(
                    &app,
                    json!({"type":"point","index":index,"x":x,"y":y,"role":if index < 4 {"defense"} else {"attack"},"main":is_fortress && index == 0,"next":next}),
                );
            }
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !CALIBRATION_ACTIVE.load(Ordering::Relaxed) {
                    log.write("[cal] остановлено из редактора");
                    finish(json!({"type":"stopped","points":captured}));
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                finish(json!({"type":"error","message":"Канал горячих клавиш закрыт"}));
                return;
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn request_calibration_stop() {
    CALIBRATION_ACTIVE.store(false, Ordering::SeqCst);
}

#[cfg(not(target_os = "windows"))]
pub fn run_calibration_session(_app: tauri::AppHandle, _executable: &Path, _options: &Value) {}

#[cfg(target_os = "windows")]
pub fn game_is_running() -> bool {
    game_process_is_running()
}

#[cfg(target_os = "windows")]
pub fn spawn_calibration(app: AppHandle, executable: PathBuf, options: Value) -> Result<Value, String> {
    if !executable.is_file() {
        return Err(format!(
            "Исполняемый файл BFME не найден: {}",
            executable.display()
        ));
    }
    thread::Builder::new()
        .name("bfme-calibration".into())
        .spawn(move || run_calibration_session(app, &executable, &options))
        .map_err(|error| format!("Не удалось запустить калибровку: {error}"))?;
    Ok(json!({"ok": true}))
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_calibration(_app: tauri::AppHandle, _executable: PathBuf, _options: Value) -> Result<Value, String> {
    Err("Калибровка координат поддерживается только в Windows".into())
}

#[cfg(not(target_os = "windows"))]
pub fn request_calibration_stop() {}

#[cfg(not(target_os = "windows"))]
pub fn game_is_running() -> bool {
    false
}
