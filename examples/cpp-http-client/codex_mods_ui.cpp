#include "codex_mods_ui.h"
#include <commctrl.h>
#include <shlobj.h>
#include <wchar.h>
#include <stdio.h>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "shell32.lib")

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif

enum { IDC_TAB = 100, IDC_DISCLAIMER = 101, IDC_SAVE = 102, IDC_PANEL_BASE = 1000 };
enum { IDJ_NONE = 2100, IDJ_LONG, IDJ_PARACHUTE, IDJ_DOUBLE, IDJ_TRIPLE, IDJ_JETPACK };

static HWND g_tab;
static HWND g_panels[5];

static const wchar_t* kTabNames[] = { L"Player", L"Jump mode", L"Fish", L"Worlds", L"Misc" };

static const wchar_t* kPlayer[] = {
    L"God Mod",
    L"Anti-Lava Bounce",
    L"Anti-Spring",
    L"Anti-Swim",
    L"Anti-Elevator",
    L"Anti-Pinball",
    L"Anti-Trampolin",
    L"Anti-Wind",
    L"Anti-Elastic",
    L"Infinite Jump",
    L"Anti-Inverted Controls",
};
static const wchar_t* kFish[] = {
    L"Fish Speed Hack",
    L"Freeze Fish Position",
    L"Fish Position Freeze + Can't MissClick",
};
static const wchar_t* kWorlds[] = {
    L"Trap Always OFF",
    L"Light Hack",
    L"Fog Hack",
    L"Local Edit World",
};
static const wchar_t* kMisc[] = {
    L"Unlock Recipes",
    L"Place Seed In Air",
    L"Always Swim",
    L"Always Jumping",
    L"Sticky Block V1",
    L"Sticky Block V2",
    L"Zero Gravity",
    L"Anti-AFK Kick",
    L"Anti-Word Censor",
    L"Anti-CheckPoint",
    L"Anti-Portal",
    L"Anti-Pick",
    L"Anti-Jump",
};

static const wchar_t* kJumpRadios[] = {
    L"(none)",
    L"Long Jump",
    L"Parachute",
    L"Double Jump",
    L"Triple Jump",
    L"JetPack",
};

static void GetPrefsPath(wchar_t* out, size_t cch) {
    out[0] = 0;
    wchar_t base[MAX_PATH];
    if (FAILED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, base)))
        return;
    swprintf_s(out, cch, L"%s\\CodeX", base);
    CreateDirectoryW(out, NULL);
    size_t n = wcslen(out);
    if (n + 20 < cch)
        wcscat_s(out, cch, L"\\mod_prefs.ini");
}

static void LoadCheck(HWND h, const wchar_t* section, const wchar_t* key) {
    wchar_t path[MAX_PATH];
    GetPrefsPath(path, MAX_PATH);
    if (!path[0]) return;
    int v = GetPrivateProfileIntW(section, key, 0, path);
    SendMessageW(h, BM_SETCHECK, v ? BST_CHECKED : BST_UNCHECKED, 0);
}

static void SaveCheck(HWND h, const wchar_t* section, const wchar_t* key) {
    wchar_t path[MAX_PATH];
    GetPrefsPath(path, MAX_PATH);
    if (!path[0]) return;
    LRESULT st = SendMessageW(h, BM_GETCHECK, 0, 0);
    WritePrivateProfileStringW(section, key, (st == BST_CHECKED) ? L"1" : L"0", path);
}

static void LayoutPanel(HWND panel, const wchar_t* section, const wchar_t** labels, int n, int baseId) {
    RECT r;
    GetClientRect(panel, &r);
    int y = 8;
    for (int i = 0; i < n; ++i) {
        HWND cb = CreateWindowExW(0, L"BUTTON", labels[i],
            WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX | WS_TABSTOP,
            12, y, r.right - 24, 22, panel, (HMENU)(INT_PTR)(baseId + i), GetModuleHandleW(NULL), NULL);
        SendMessageW(cb, WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);
        wchar_t key[64];
        swprintf_s(key, L"m%d", baseId + i);
        LoadCheck(cb, section, key);
        y += 24;
    }
}

static void BuildJumpPanel(HWND panel) {
    RECT r;
    GetClientRect(panel, &r);
    int y = 8;
    for (int i = 0; i < 6; ++i) {
        DWORD style = WS_CHILD | WS_VISIBLE | BS_AUTORADIOBUTTON | WS_TABSTOP;
        if (i == 0) style |= WS_GROUP;
        HWND rb = CreateWindowExW(0, L"BUTTON", kJumpRadios[i], style,
            12, y, r.right - 24, 22, panel, (HMENU)(INT_PTR)(IDJ_NONE + i), GetModuleHandleW(NULL), NULL);
        SendMessageW(rb, WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);
        y += 24;
    }
    wchar_t path[MAX_PATH];
    GetPrefsPath(path, MAX_PATH);
    int sel = 0;
    if (path[0])
        sel = GetPrivateProfileIntW(L"Jump", L"Mode", 0, path);
    if (sel < 0 || sel > 5) sel = 0;
    CheckRadioButton(panel, IDJ_NONE, IDJ_JETPACK, IDJ_NONE + sel);
}

static void ShowPanel(int idx) {
    for (int i = 0; i < 5; ++i) {
        if (g_panels[i])
            ShowWindow(g_panels[i], (i == idx) ? SW_SHOW : SW_HIDE);
    }
}

static LRESULT CALLBACK ForwardPanelProc(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR, DWORD_PTR mainHwnd) {
    if (m == WM_COMMAND)
        SendMessageW((HWND)mainHwnd, m, w, l);
    return DefSubclassProc(h, m, w, l);
}

static void SaveAllPrefs(HWND root) {
    (void)root;
    wchar_t path[MAX_PATH];
    GetPrefsPath(path, MAX_PATH);
    if (!path[0]) return;

    for (int p = 0; p < 5; ++p) {
        HWND panel = g_panels[p];
        if (!panel) continue;
        HWND ch = GetWindow(panel, GW_CHILD);
        while (ch) {
            wchar_t cls[32];
            GetClassNameW(ch, cls, 32);
            int id = (int)(INT_PTR)GetWindowLongPtrW(ch, GWLP_ID);
            if (_wcsicmp(cls, L"BUTTON") == 0) {
                LONG st = (LONG)GetWindowLongPtrW(ch, GWL_STYLE);
                if (st & BS_AUTOCHECKBOX) {
                    wchar_t sec[16], key[32];
                    if (p == 0) {
                        wcscpy_s(sec, L"Player");
                        swprintf_s(key, L"m%d", id);
                    } else if (p == 2) {
                        wcscpy_s(sec, L"Fish");
                        swprintf_s(key, L"m%d", id);
                    } else if (p == 3) {
                        wcscpy_s(sec, L"Worlds");
                        swprintf_s(key, L"m%d", id);
                    } else if (p == 4) {
                        wcscpy_s(sec, L"Misc");
                        swprintf_s(key, L"m%d", id);
                    } else {
                        ch = GetWindow(ch, GW_HWNDNEXT);
                        continue;
                    }
                    SaveCheck(ch, sec, key);
                } else if ((st & BS_AUTORADIOBUTTON) && id >= IDJ_NONE && id <= IDJ_JETPACK) {
                    if (SendMessageW(ch, BM_GETCHECK, 0, 0) == BST_CHECKED) {
                        int mode = id - IDJ_NONE;
                        wchar_t buf[8];
                        swprintf_s(buf, L"%d", mode);
                        WritePrivateProfileStringW(L"Jump", L"Mode", buf, path);
                    }
                }
            }
            ch = GetWindow(ch, GW_HWNDNEXT);
        }
    }
}

static void CreatePanels(HWND main, RECT content) {
    for (int i = 0; i < 5; ++i) {
        g_panels[i] = CreateWindowExW(WS_EX_CONTROLPARENT, L"STATIC", L"",
            WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
            content.left, content.top,
            content.right - content.left, content.bottom - content.top,
            main, (HMENU)(INT_PTR)(IDC_PANEL_BASE + i), GetModuleHandleW(NULL), NULL);
        SendMessageW(g_panels[i], WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);
        SetWindowSubclass(g_panels[i], ForwardPanelProc, (UINT_PTR)(200 + i), (DWORD_PTR)main);
    }

    LayoutPanel(g_panels[0], L"Player", kPlayer, (int)(sizeof(kPlayer) / sizeof(kPlayer[0])), 3000);
    BuildJumpPanel(g_panels[1]);

    LayoutPanel(g_panels[2], L"Fish", kFish, (int)(sizeof(kFish) / sizeof(kFish[0])), 4000);
    LayoutPanel(g_panels[3], L"Worlds", kWorlds, (int)(sizeof(kWorlds) / sizeof(kWorlds[0])), 5000);
    LayoutPanel(g_panels[4], L"Misc", kMisc, (int)(sizeof(kMisc) / sizeof(kMisc[0])), 6000);

    ShowPanel(0);
}

static void RemovePanelSubclasses(HWND main) {
    (void)main;
    for (int i = 0; i < 5; ++i) {
        if (g_panels[i]) {
            RemoveWindowSubclass(g_panels[i], ForwardPanelProc, (UINT_PTR)(200 + i));
            g_panels[i] = NULL;
        }
    }
}

static LRESULT CALLBACK MainWndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_CREATE: {
        INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_TAB_CLASSES | ICC_STANDARD_CLASSES };
        InitCommonControlsEx(&icc);

        RECT cr;
        GetClientRect(h, &cr);

        CreateWindowExW(0, L"STATIC",
            L"This panel only saves your mod checklist locally (AppData). "
            L"It does not attach to Pixel Worlds or run Cheat Engine scripts.",
            WS_CHILD | WS_VISIBLE | SS_LEFT,
            12, 8, cr.right - 24, 40, h, (HMENU)(INT_PTR)IDC_DISCLAIMER, GetModuleHandleW(NULL), NULL);
        SendMessageW(GetDlgItem(h, IDC_DISCLAIMER), WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);

        g_tab = CreateWindowExW(0, WC_TABCONTROLW, L"",
            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
            12, 52, cr.right - 24, 28, h, (HMENU)(INT_PTR)IDC_TAB, GetModuleHandleW(NULL), NULL);
        SendMessageW(g_tab, WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);

        TCITEMW ti = { 0 };
        ti.mask = TCIF_TEXT;
        for (int i = 0; i < 5; ++i) {
            ti.pszText = (LPWSTR)kTabNames[i];
            TabCtrl_InsertItem(g_tab, i, &ti);
        }

        RECT tr = { 12, 84, cr.right - 12, cr.bottom - 48 };
        TabCtrl_AdjustRect(g_tab, FALSE, &tr);

        CreatePanels(h, tr);

        CreateWindowExW(0, L"BUTTON", L"Save & close",
            WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON | WS_TABSTOP,
            cr.right - 140, cr.bottom - 40, 128, 28, h, (HMENU)(INT_PTR)IDC_SAVE, GetModuleHandleW(NULL), NULL);
        SendMessageW(GetDlgItem(h, IDC_SAVE), WM_SETFONT, (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);
        return 0;
    }
    case WM_NOTIFY: {
        if (((LPNMHDR)l)->idFrom == IDC_TAB && ((LPNMHDR)l)->code == TCN_SELCHANGE) {
            int i = TabCtrl_GetCurSel(g_tab);
            if (i >= 0) ShowPanel(i);
        }
        return 0;
    }
    case WM_COMMAND:
        if (LOWORD(w) == IDC_SAVE) {
            SaveAllPrefs(h);
            RemovePanelSubclasses(h);
            DestroyWindow(h);
            return 0;
        }
        if (HIWORD(w) == BN_CLICKED) {
            int id = LOWORD(w);
            if (id >= IDJ_NONE && id <= IDJ_JETPACK) {
                HWND btn = (HWND)l;
                HWND panel = GetParent(btn);
                if (panel) CheckRadioButton(panel, IDJ_NONE, IDJ_JETPACK, id);
                return 0;
            }
        }
        break;
    case WM_CLOSE:
        RemovePanelSubclasses(h);
        DestroyWindow(h);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

int ShowModPreferenceWindow(HWND owner) {
    INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_TAB_CLASSES | ICC_STANDARD_CLASSES };
    InitCommonControlsEx(&icc);

    static ATOM clsAtom = 0;
    if (!clsAtom) {
        WNDCLASSW wc = { 0 };
        wc.lpfnWndProc = MainWndProc;
        wc.hInstance = GetModuleHandleW(NULL);
        wc.lpszClassName = L"CodeXModPrefs";
        wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
        wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
        clsAtom = RegisterClassW(&wc);
        if (!clsAtom) return -1;
    }

    HWND h = CreateWindowExW(0, L"CodeXModPrefs", L"CodeX — mod checklist (local only)",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT, 520, 520,
        owner, NULL, GetModuleHandleW(NULL), NULL);
    if (!h) return -2;

    ShowWindow(h, SW_SHOW);
    UpdateWindow(h);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        if (!IsDialogMessageW(h, &msg)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    return (int)msg.wParam;
}
