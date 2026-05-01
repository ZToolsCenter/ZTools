/**
 * copilot_hook.cpp
 *
 * Windows Copilot key interceptor - Native Node.js Addon
 *
 * Uses WH_KEYBOARD_LL low-level keyboard hook to synchronously intercept
 * Win+Shift+F23 (Copilot key) in C++, returning 1 to block the key event,
 * then asynchronously notifies Node.js via ThreadSafeFunction.
 *
 * Critical: The interception check and return 1 happen synchronously in C++,
 * so Windows will NOT hit the low-level hook timeout (~300ms).
 */

#include <node_api.h>
#include <windows.h>

// Constants
#define VK_F23 0x86
#define VK_LWIN 0x5B
#define VK_RWIN 0x5C
#define VK_LSHIFT 0xA0
#define VK_RSHIFT 0xA1
#define KEYEVENTF_KEYUP 0x0002

// Global state
static napi_threadsafe_function g_tsfn = NULL;
static HHOOK g_hook_handle = NULL;
static BOOL g_is_running = FALSE;
static volatile LONG g_in_hook = 0; // Reentrancy guard

// WH_KEYBOARD_LL hook callback
static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    // Reentrancy guard: prevent recursion if keybd_event re-triggers this hook
    if (InterlockedCompareExchange(&g_in_hook, 1, 0) != 0) {
        return CallNextHookEx(g_hook_handle, nCode, wParam, lParam);
    }

    LRESULT result = 0;

    if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN)) {
        KBDLLHOOKSTRUCT* pKb = (KBDLLHOOKSTRUCT*)lParam;

        if (pKb->vkCode == VK_F23) {
            BOOL winDown = (GetAsyncKeyState(VK_LWIN) & 0x8000) ||
                           (GetAsyncKeyState(VK_RWIN) & 0x8000);
            BOOL shiftDown = (GetAsyncKeyState(VK_LSHIFT) & 0x8000) ||
                             (GetAsyncKeyState(VK_RSHIFT) & 0x8000);

            if (winDown && shiftDown) {
                // Safety: inject a dummy key (VK_NONAME = 0xFC) to break
                // the system's Win+... hotkey sequence recognition.
                // The reentrancy guard above prevents this from causing recursion.
                keybd_event(0xFC, 0, 0, 0);
                keybd_event(0xFC, 0, KEYEVENTF_KEYUP, 0);

                // Asynchronously notify Node.js (non-blocking)
                if (g_tsfn != NULL) {
                    napi_call_threadsafe_function(g_tsfn, NULL, napi_tsfn_nonblocking);
                }

                // Synchronously return 1 to block the key event in C++.
                // This is the key: no JS engine involved, no timeout risk.
                InterlockedExchange(&g_in_hook, 0);
                return 1;
            }
        }
    }

    result = CallNextHookEx(g_hook_handle, nCode, wParam, lParam);

    InterlockedExchange(&g_in_hook, 0);
    return result;
}

// ThreadSafeFunction callback - executes on Node.js main thread
static void CallJs(napi_env env, napi_value js_cb, void* context, void* data) {
    if (env == NULL || js_cb == NULL) {
        return;
    }

    // Call the JS callback with no arguments, using undefined as this
    napi_value undefined;
    napi_get_undefined(env, &undefined);

    napi_call_function(env, undefined, js_cb, 0, NULL, NULL);
}

// startHook(callback) - Install the WH_KEYBOARD_LL hook
static napi_value StartHook(napi_env env, napi_callback_info info) {
    napi_value result_bool;
    napi_get_boolean(env, TRUE, &result_bool);

    if (g_is_running) {
        return result_bool;
    }

    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    if (argc < 1) {
        napi_throw_type_error(env, NULL, "callback is required");
        return NULL;
    }

    // Create ThreadSafeFunction
    napi_value async_resource_name;
    napi_create_string_utf8(env, "CopilotHook", NAPI_AUTO_LENGTH, &async_resource_name);

    napi_status status = napi_create_threadsafe_function(
        env,
        argv[0],               // func: JS callback function
        NULL,                  // async_resource
        async_resource_name,   // async_resource_name
        0,                     // max_queue_size (0 = unlimited)
        1,                     // initial_thread_count
        NULL,                  // thread_finalize_data
        NULL,                  // thread_finalize_cb
        NULL,                  // context
        CallJs,                // call_js_cb
        &g_tsfn                // result
    );

    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to create threadsafe function");
        return NULL;
    }

    // Install WH_KEYBOARD_LL hook
    g_hook_handle = SetWindowsHookExW(
        WH_KEYBOARD_LL,
        LowLevelKeyboardProc,
        GetModuleHandleW(NULL),
        0
    );

    if (g_hook_handle == NULL) {
        napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
        g_tsfn = NULL;
        napi_throw_error(env, NULL, "SetWindowsHookExW failed - may need admin privileges");
        return NULL;
    }

    g_is_running = TRUE;

    return result_bool;
}

// stopHook() - Remove the WH_KEYBOARD_LL hook
static napi_value StopHook(napi_env env, napi_callback_info info) {
    napi_value result_bool;
    napi_get_boolean(env, TRUE, &result_bool);

    if (!g_is_running) {
        return result_bool;
    }

    if (g_hook_handle != NULL) {
        UnhookWindowsHookEx(g_hook_handle);
        g_hook_handle = NULL;
    }

    if (g_tsfn != NULL) {
        napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
        g_tsfn = NULL;
    }

    g_is_running = FALSE;

    return result_bool;
}

// Module initialization
static napi_value Init(napi_env env, napi_value exports) {
    napi_value fn_start, fn_stop;

    napi_create_function(env, "startHook", NAPI_AUTO_LENGTH, StartHook, NULL, &fn_start);
    napi_set_named_property(env, exports, "startHook", fn_start);

    napi_create_function(env, "stopHook", NAPI_AUTO_LENGTH, StopHook, NULL, &fn_stop);
    napi_set_named_property(env, exports, "stopHook", fn_stop);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
