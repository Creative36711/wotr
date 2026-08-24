#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if war_of_the_ring_lib::run_rts_helper_if_requested() {
        return;
    }
    war_of_the_ring_lib::run();
}
