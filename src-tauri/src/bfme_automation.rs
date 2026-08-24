use serde_json::{json, Value};
use std::{
    ffi::{c_void, OsString},
    mem::{size_of, zeroed},
    path::{Path, PathBuf},
    process::Command,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, OnceLock,
    },
    thread,
    time::{Duration, Instant},
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
const TH32CS_SNAPPROCESS: u32 = 0x00000002;
#[cfg(target_os = "windows")]
const WH_KEYBOARD_LL: i32 = 13;
#[cfg(target_os = "windows")]
const WH_MOUSE_LL: i32 = 14;
#[cfg(target_os = "windows")]
const SEE_MASK_NOCLOSEPROCESS: u32 = 0x00000040;
#[cfg(target_os = "windows")]
const SEE_MASK_FLAG_NO_UI: u32 = 0x00000400;
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

#[cfg(target_os = "windows")]
static INPUT_BLOCKING: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static INPUT_HOOKS_READY: OnceLock<Result<(), String>> = OnceLock::new();

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
        unsafe { GetLocalTime(&mut now) }
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
        thread::sleep(MENU_MARKER_POLL)
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
fn click_fraction(viewport: (i32, i32, i32, i32), x: f64, y: f64) -> Result<(), String> {
    click(
        viewport.0 + (x * viewport.2 as f64) as i32,
        viewport.1 + (y * viewport.3 as f64) as i32,
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

#[cfg(target_os = "windows")]
fn set_difficulty(
    viewport: (i32, i32, i32, i32),
    slot: usize,
    difficulty: usize,
) -> Result<(), String> {
    let x = viewport.0 + (0.177 * viewport.2 as f64) as i32;
    let selector_y = viewport.1 + (SLOT_Y[slot - 1] * viewport.3 as f64) as i32;
    click(x, selector_y)?;
    thread::sleep(Duration::from_millis(600));
    click(
        x,
        viewport.1
            + ((SLOT_Y[slot - 1] + DIFF_OFFSETS[difficulty.min(3)]) * viewport.3 as f64) as i32,
    )?;
    thread::sleep(Duration::from_millis(400));
    Ok(())
}

#[cfg(target_os = "windows")]
fn pick_dropdown(
    viewport: (i32, i32, i32, i32),
    slot: usize,
    column: f64,
    item_index: usize,
) -> Result<(), String> {
    let visible_rows = usize::max(4, 9usize.saturating_sub(slot));
    let visible_items = visible_rows - 1;
    let x = viewport.0 + (column * viewport.2 as f64) as i32;
    let selector_y = viewport.1 + (SLOT_Y[slot - 1] * viewport.3 as f64) as i32;
    let list_top = SLOT_Y[slot - 1] + DROP_GAP;
    click(x, selector_y)?;
    thread::sleep(Duration::from_millis(600));
    let target_y = if item_index < visible_items {
        list_top + (item_index + 1) as f64 * DROP_STEP
    } else {
        move_mouse(x, selector_y + (0.05 * viewport.3 as f64) as i32)?;
        let notches = item_index - visible_items + 1;
        for _ in 0..notches {
            scroll(-1)?;
        }
        thread::sleep(Duration::from_millis(200));
        list_top + (visible_rows - 1) as f64 * DROP_STEP
    };
    click(x, viewport.1 + (target_y * viewport.3 as f64) as i32)?;
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

#[cfg(target_os = "windows")]
fn launch_and_configure_inner(executable: &Path, config: &Value) -> Result<(), String> {
    let log = AutomationLog::start();
    let language = config
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("ru");
    if game_process_is_running() {
        return Err("BFME уже запущен. Закройте game.dat перед началом RTS-боя.".into());
    }
    let _input_lock = InputLockGuard::acquire()?;
    let pref_result = update_network_pref(executable, config)?;
    log.write(format!(
        "[prefs] NetworkPref.ini prepared in {} profile folder(s)",
        pref_result.paths.len()
    ));
    log.write("[launch] starting BFME");
    Command::new(executable)
        .current_dir(executable.parent().ok_or("Не найдена папка игры")?)
        .spawn()
        .map_err(|error| format!("Не удалось запустить BFME: {error}"))?;

    log.write("[wait] waiting for the game.dat window (up to 120s)");
    let (window, discovery) = wait_for_game_window(Duration::from_secs(120))?;
    log.write(format!("[window] found via {discovery}"));
    unsafe {
        SetForegroundWindow(window);
    }
    wait_for_menu_ready(window, &log, language)?;
    let viewport = viewport(window)?;
    unsafe {
        SetForegroundWindow(window);
    }

    log.write("[nav] Network -> Local Network -> Create Game");
    move_mouse(
        viewport.0 + (0.3019 * viewport.2 as f64) as i32,
        viewport.1 + (0.9244 * viewport.3 as f64) as i32,
    )?;
    thread::sleep(Duration::from_millis(800));
    click_fraction(viewport, 0.3000, 0.7811)?;
    thread::sleep(Duration::from_secs(2));
    click_fraction(viewport, 0.8337, 0.4611)?;
    thread::sleep(Duration::from_secs(2));

    let participants = config
        .get("participants")
        .and_then(Value::as_array)
        .ok_or("В battle_config отсутствуют участники")?;
    if participants.len() < 2 || participants.len() > 8 {
        return Err("BFME поддерживает от 2 до 8 RTS-слотов".into());
    }
    let difficulty = config
        .get("difficulty")
        .and_then(|value| value.get("bfmeIndex"))
        .and_then(Value::as_u64)
        .unwrap_or(1) as usize;

    log.write(format!(
        "[room] configuring {} RTS slots",
        participants.len()
    ));
    // Проверенный порядок Python PoC: сложность -> фракции -> союзы -> цвета.
    for slot in 2..=participants.len() {
        set_difficulty(viewport, slot, difficulty)?;
    }
    // Фракция и цвет игрока уже заданы через NetworkPref.ini. В комнате
    // меняем только ботов, чтобы не создавать лишние клики по первому слоту.
    for (index, participant) in participants.iter().enumerate().skip(1) {
        let list_index = participant
            .get("listIndex")
            .and_then(Value::as_u64)
            .ok_or("Нет индекса фракции BFME")? as usize;
        pick_dropdown(viewport, index + 1, 0.383, list_index)?;
    }
    for (index, participant) in participants.iter().enumerate() {
        let alliance = if participant.get("side").and_then(Value::as_str) == Some("evil") {
            1
        } else {
            0
        };
        pick_dropdown(viewport, index + 1, 0.685, alliance)?;
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
        pick_dropdown(viewport, index + 1, 0.744, adjusted)?;
        used_colors.push(color);
    }

    if let Some(map) = config.get("map") {
        if let (Some(position), Some(slot)) = (
            map.get("defenderStartPosition"),
            map.get("defenderSlot").and_then(Value::as_u64),
        ) {
            let x = position
                .get("x")
                .and_then(Value::as_f64)
                .ok_or("Нет X стартовой позиции крепости")?;
            let y = position
                .get("y")
                .and_then(Value::as_f64)
                .ok_or("Нет Y стартовой позиции крепости")?;
            for _ in 0..slot {
                click_fraction(viewport, x, y)?;
                thread::sleep(Duration::from_millis(200));
            }
        }
    }

    log.write("[room] clicking Start Game");
    click_fraction(viewport, 0.8836, 0.9542)?;
    thread::sleep(Duration::from_secs(7));
    log.write("[done] battle launched");
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn launch_and_configure(executable: &Path, config: &Value) -> Result<(), String> {
    launch_and_configure_inner(executable, config)
}

#[cfg(not(target_os = "windows"))]
pub fn launch_and_configure(_executable: &Path, _config: &Value) -> Result<(), String> {
    Err("Автоматизация BFME поддерживается только в Windows".into())
}

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
            "removing obsolete WOTR files"=>"удаление устаревших файлов WOTR",
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
    let destinations:Vec<PathBuf>=entries.iter().filter_map(|entry|entry.get("destinationPath").and_then(Value::as_str).map(PathBuf::from)).collect();
    if let Some(game_dir)=destinations.first().and_then(|path|path.parent()){for legacy in ["__wotr_ini.big","__wotr_maps.big","__wotr_maps_cache.big"]{let path=game_dir.join(legacy);let supplied=destinations.iter().any(|destination|destination.file_name().and_then(|name|name.to_str()).is_some_and(|name|name.eq_ignore_ascii_case(legacy)));if path.exists()&&!supplied{std::fs::remove_file(&path).map_err(|error|deployment_error(language,"removing obsolete WOTR files",&path,&error))?;}}}
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
    let wait = unsafe { WaitForSingleObject(info.process, INFINITE) };
    unsafe {
        CloseHandle(info.process);
    }
    if wait == WAIT_FAILED {
        return Err(format!(
            "Ошибка ожидания elevated-автоматизации: Windows error {}",
            last_error()
        ));
    }
    let result_text = std::fs::read_to_string(result_path)
        .map_err(|error| format!("Elevated-автоматизация не вернула результат: {error}"))?;
    let result: Value = serde_json::from_str(&result_text)
        .map_err(|error| format!("Повреждён ответ elevated-автоматизации: {error}"))?;
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(result
            .get("deployed")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    } else {
        Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Автоматизация BFME завершилась с неизвестной ошибкой")
            .to_string())
    }
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
        let deployed = deploy_job_files(deployment, language)?;
        launch_and_configure_inner(executable, config)?;
        return Ok(deployed);
    }
    std::fs::create_dir_all(temp_directory).map_err(|error| error.to_string())?;
    let job_path = temp_directory.join("rts_automation_job.json");
    let result_path = temp_directory.join("rts_automation_result.json");
    let _ = std::fs::remove_file(&result_path);
    let job = json!({
        "executablePath": executable.to_string_lossy(),
        "battleConfig": config,
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
    executable: &Path,
    config: &Value,
    _temp_directory: &Path,
    deployment: &Value,
) -> Result<Vec<Value>, String> {
    let deployed = deploy_job_files(
        deployment,
        config
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or("en"),
    )?;
    launch_and_configure(executable, config)?;
    Ok(deployed)
}

#[cfg(not(target_os = "windows"))]
pub fn launch_with_elevation(
    executable: &Path,
    config: &Value,
    temp_directory: &Path,
) -> Result<(), String> {
    deploy_and_launch_with_elevation(executable, config, temp_directory, &json!([])).map(|_| ())
}

fn helper_arguments() -> Option<(PathBuf, PathBuf)> {
    let arguments: Vec<OsString> = std::env::args_os().collect();
    if arguments.get(1).and_then(|value| value.to_str()) != Some("--wotr-rts-helper") {
        return None;
    }
    let job_path = arguments.get(2).map(PathBuf::from)?;
    let result_path = arguments.get(3).map(PathBuf::from)?;
    Some((job_path, result_path))
}

pub fn run_helper_if_requested() -> bool {
    let Some((job_path, result_path)) = helper_arguments() else {
        return false;
    };
    let result = (|| -> Result<Vec<Value>, String> {
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
            .ok_or("battleConfig is missing from the automation job")?;
        let language = config
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or("ru");
        let deployed = deploy_job_files(job.get("deployment").unwrap_or(&Value::Null), language)?;
        launch_and_configure(&executable, config)?;
        Ok(deployed)
    })();
    let response = match result {
        Ok(deployed) => json!({ "ok": true, "deployed": deployed }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    if let Some(parent) = result_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &result_path,
        serde_json::to_vec_pretty(&response)
            .unwrap_or_else(|_| b"{\"ok\":false,\"error\":\"serialization failed\"}".to_vec()),
    );
    true
}
