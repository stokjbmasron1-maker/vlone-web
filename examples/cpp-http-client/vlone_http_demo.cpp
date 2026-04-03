#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#include <string>
#include <vector>
#include <cstring>
#include <cstdio>
#include <iostream>

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "advapi32.lib")

static const wchar_t* kHost = L"vlone-web.vercel.app";
static const wchar_t* kVerifyPath = L"/api/verify";

static HANDLE g_hOut = INVALID_HANDLE_VALUE;
static HANDLE g_hErr = INVALID_HANDLE_VALUE;

static void IoInit() {
  g_hOut = GetStdHandle(STD_OUTPUT_HANDLE);
  g_hErr = GetStdHandle(STD_ERROR_HANDLE);
}

static void WriteRaw(HANDLE h, const void* p, DWORD n) {
  if (!p || n == 0 || h == INVALID_HANDLE_VALUE || !h) return;
  DWORD w = 0;
  WriteFile(h, p, n, &w, nullptr);
}

static void Out(const char* z) {
  if (z && *z) WriteRaw(g_hOut, z, static_cast<DWORD>(std::strlen(z)));
}

static void Out(const std::string& s) {
  if (!s.empty()) WriteRaw(g_hOut, s.data(), static_cast<DWORD>(s.size()));
}

static void OutLn(const char* z) {
  Out(z);
  WriteRaw(g_hOut, "\r\n", 2);
}

static void Err(const char* z) {
  if (z && *z) WriteRaw(g_hErr, z, static_cast<DWORD>(std::strlen(z)));
}

static void Err(const std::string& s) {
  if (!s.empty()) WriteRaw(g_hErr, s.data(), static_cast<DWORD>(s.size()));
}

static void ErrLn(const char* z) {
  Err(z);
  WriteRaw(g_hErr, "\r\n", 2);
}

static void ErrLastWin32(const char* prefix) {
  char buf[96];
  DWORD e = GetLastError();
  std::snprintf(buf, sizeof buf, "%s GetLastError=%lu\r\n", prefix, static_cast<unsigned long>(e));
  Err(buf);
}

static bool HttpsPostJson(const wchar_t* host, const wchar_t* path, const std::string& bodyUtf8,
                          std::string& responseOut, DWORD& statusCodeOut) {
  responseOut.clear();
  statusCodeOut = 0;

  HINTERNET hSession =
      WinHttpOpen(L"VLONE-Client/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME,
                  WINHTTP_NO_PROXY_BYPASS, 0);
  if (!hSession) return false;

  HINTERNET hConnect = WinHttpConnect(hSession, host, INTERNET_DEFAULT_HTTPS_PORT, 0);
  if (!hConnect) {
    WinHttpCloseHandle(hSession);
    return false;
  }

  HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", path, nullptr, WINHTTP_NO_REFERER,
                                          WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
  if (!hRequest) {
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return false;
  }

  const wchar_t* hdr = L"Content-Type: application/json\r\n";
  WinHttpAddRequestHeaders(hRequest, hdr, static_cast<DWORD>(-1), WINHTTP_ADDREQ_FLAG_ADD);

  const DWORD len = static_cast<DWORD>(bodyUtf8.size());
  std::vector<char> postCopy;
  if (len > 0) postCopy.assign(bodyUtf8.begin(), bodyUtf8.end());

  BOOL ok = WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0,
                               len, 0);
  if (!ok) {
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return false;
  }

  if (len > 0) {
    DWORD sent = 0;
    if (!WinHttpWriteData(hRequest, postCopy.data(), len, &sent) || sent != len) {
      WinHttpCloseHandle(hRequest);
      WinHttpCloseHandle(hConnect);
      WinHttpCloseHandle(hSession);
      return false;
    }
  }

  ok = WinHttpReceiveResponse(hRequest, nullptr);
  if (!ok) {
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return false;
  }

  DWORD code = 0, sz = sizeof(code);
  WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                      WINHTTP_HEADER_NAME_BY_INDEX, &code, &sz, WINHTTP_NO_HEADER_INDEX);
  statusCodeOut = code;

  for (;;) {
    DWORD avail = 0;
    if (!WinHttpQueryDataAvailable(hRequest, &avail) || avail == 0) break;
    const DWORD kMaxChunk = 1024 * 1024;
    if (avail > kMaxChunk) avail = kMaxChunk;
    std::vector<char> chunk(static_cast<size_t>(avail));
    DWORD read = 0;
    if (!WinHttpReadData(hRequest, chunk.data(), avail, &read) || read == 0) break;
    responseOut.append(chunk.data(), read);
  }

  WinHttpCloseHandle(hRequest);
  WinHttpCloseHandle(hConnect);
  WinHttpCloseHandle(hSession);
  return true;
}

static bool HttpsPostJsonSafe(const wchar_t* host, const wchar_t* path,
                              const std::string& bodyUtf8, std::string& responseOut,
                              DWORD& statusCodeOut, DWORD* sehExceptionOut) {
  if (sehExceptionOut) *sehExceptionOut = 0;
  bool ok = false;
#if defined(_MSC_VER)
  __try {
    ok = HttpsPostJson(host, path, bodyUtf8, responseOut, statusCodeOut);
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    if (sehExceptionOut) *sehExceptionOut = GetExceptionCode();
    ok = false;
  }
#else
  ok = HttpsPostJson(host, path, bodyUtf8, responseOut, statusCodeOut);
#endif
  return ok;
}

static bool JsonBoolTrue(const std::string& j, const char* key) {
  std::string a = std::string("\"") + key + "\":true";
  std::string b = std::string("\"") + key + "\": true";
  return j.find(a) != std::string::npos || j.find(b) != std::string::npos;
}

static std::string JsonStringValue(const std::string& j, const char* key) {
  std::string pat = std::string("\"") + key + "\":\"";
  size_t p = j.find(pat);
  if (p == std::string::npos) return {};
  p += pat.size();
  size_t e = j.find('"', p);
  if (e == std::string::npos) return {};
  return j.substr(p, e - p);
}

static std::string Trim(const std::string& s) {
  size_t a = 0, b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r' || s[a] == '\n')) ++a;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r' || s[b - 1] == '\n')) --b;
  return s.substr(a, b - a);
}

static std::string JsonEscape(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    if (c == '\\')
      o += "\\\\";
    else if (c == '"')
      o += "\\\"";
    else if (c < 0x20)
      o += ' ';
    else
      o += static_cast<char>(c);
  }
  return o;
}

static std::string Utf8FromWide(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  if (n <= 0) return "pc";
  std::string out(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), out.data(), n, nullptr, nullptr);
  return out;
}

static std::string Utf8FromWideZ(const wchar_t* z) {
  if (!z || !*z) return {};
  return Utf8FromWide(std::wstring(z, wcslen(z)));
}

static std::string ReadMachineGuidUtf8() {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Cryptography", 0,
                    KEY_READ | KEY_WOW64_64KEY, &key) != ERROR_SUCCESS ||
      !key)
    return {};

  wchar_t buf[80] = {};
  DWORD bytes = sizeof(buf);
  DWORD type = 0;
  LONG q = RegQueryValueExW(key, L"MachineGuid", nullptr, &type,
                            reinterpret_cast<LPBYTE>(buf), &bytes);
  RegCloseKey(key);
  if (q != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ)) return {};

  size_t n = 0;
  while (n < 79 && buf[n] != L'\0') ++n;
  return Utf8FromWide(std::wstring(buf, n));
}

static std::string FallbackHwidFromPcName() {
  wchar_t buf[MAX_COMPUTERNAME_LENGTH + 1] = {};
  DWORD sz = MAX_COMPUTERNAME_LENGTH + 1;
  if (!GetComputerNameW(buf, &sz) || sz == 0) return "vlone-pc-unknown";
  std::wstring w(buf, sz);
  std::string u8 = Utf8FromWide(w);
  std::string h = "pc-" + u8;
  while (h.size() < 8) h += '0';
  if (h.size() > 256) h.resize(256);
  return h;
}

static std::string BuildHwidForApi() {
  std::string mg = Trim(ReadMachineGuidUtf8());
  if (!mg.empty()) {
    std::string h = std::string("mg-") + mg;
    while (h.size() < 8) h += '0';
    if (h.size() > 256) h.resize(256);
    return h;
  }
  return FallbackHwidFromPcName();
}

static void PauseExit() {
  OutLn("");
  OutLn("Press Enter to exit...");
  std::string sink;
  std::getline(std::cin, sink);
}

static std::string BuildDeviceNameUtf8() {
  wchar_t buf[MAX_COMPUTERNAME_LENGTH + 1] = {};
  DWORD sz = MAX_COMPUTERNAME_LENGTH + 1;
  if (!GetComputerNameW(buf, &sz) || sz == 0) return "Unknown-PC";
  return Utf8FromWide(std::wstring(buf, sz));
}

static int RunMainBody() {
  SetConsoleOutputCP(CP_UTF8);
  SetConsoleCP(CP_UTF8);
  IoInit();

  OutLn("VLONE license check");
  OutLn("--------------------");
  OutLn("Flow:");
  OutLn("  1) You enter the license key from the web dashboard.");
  OutLn("  2) This app sends the key + this PC hardware id (HWID) to the server.");
  OutLn("  3) Server checks the key is valid and not expired.");
  OutLn("  4) If no device was linked yet, THIS device is registered.");
  OutLn("  5) If the key is already linked to another HWID, verification fails.");
  OutLn("");
  OutLn("HWID: Windows MachineGuid (registry) + prefix mg-. Fallback: PC name if unavailable.");
  OutLn("");
  Out("Enter license key (from web dashboard, e.g. VLN-XXXXXXXX-MON): ");

  std::string license;
  if (!std::getline(std::cin, license)) {
    ErrLn("ERROR: Could not read input.");
    return 1;
  }
  license = Trim(license);
  if (license.empty()) {
    ErrLn("ERROR: License key cannot be empty.");
    return 1;
  }

  const std::string hwid = BuildHwidForApi();
  const std::string devName = BuildDeviceNameUtf8();
  const std::string json = std::string("{\"key\":\"") + JsonEscape(license) + "\",\"hwid\":\"" +
                           JsonEscape(hwid) + "\",\"device_name\":\"" + JsonEscape(devName) + "\"}";

  std::string resp;
  DWORD httpStatus = 0;

  OutLn("");
  Out("POST https://");
  Out(Utf8FromWideZ(kHost));
  Out(Utf8FromWideZ(kVerifyPath));
  OutLn("");
  Out("HWID sent: ");
  Out(hwid);
  OutLn("");
  Out("Request body: ");
  Out(json);
  OutLn("");
  OutLn("");

  DWORD seh = 0;
  if (!HttpsPostJsonSafe(kHost, kVerifyPath, json, resp, httpStatus, &seh)) {
    if (seh != 0) {
      char msg[160];
      std::snprintf(msg, sizeof msg,
                    "ERROR: Exception in WinHTTP/network (0x%08lX). Try CMD, no VPN, or VS debugger.\r\n",
                    static_cast<unsigned long>(seh));
      Err(msg);
    } else {
      ErrLn("ERROR: WinHTTP request failed.");
      ErrLastWin32("");
    }
    return 1;
  }

  char statusBuf[48];
  std::snprintf(statusBuf, sizeof statusBuf, "HTTP status: %lu\r\n", static_cast<unsigned long>(httpStatus));
  Out(statusBuf);
  Out("Raw JSON: ");
  Out(resp);
  OutLn("");
  OutLn("");

  const bool valid = JsonBoolTrue(resp, "valid");
  const std::string apiMessage = JsonStringValue(resp, "message");
  const bool firstAct = JsonBoolTrue(resp, "first_activation");

  OutLn("--- Result ---");
  if (valid) {
    OutLn("STATUS: LICENSE OK");
    if (!apiMessage.empty()) {
      Out("Message: ");
      Out(apiMessage);
      OutLn("");
    }
    if (firstAct)
      OutLn("Note: This device was just registered for this license key.");
    else
      OutLn("Note: Device already matched; license checks out.");
  } else {
    OutLn("STATUS: LICENSE FAILED");
    if (!apiMessage.empty()) {
      Out("Message: ");
      Out(apiMessage);
      OutLn("");
    } else
      OutLn("Message: (see raw JSON above)");
  }

  return valid ? 0 : 2;
}

#if defined(_MSC_VER)
int main() {
  IoInit();
  SetConsoleOutputCP(CP_UTF8);
  SetConsoleCP(CP_UTF8);
  int code = 1;
  __try {
    code = RunMainBody();
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    char msg[192];
    std::snprintf(msg, sizeof msg,
                  "VLONE: fatal exception 0x%08lX.\r\nRun from Command Prompt; attach VS debugger for details.\r\n",
                  static_cast<unsigned long>(GetExceptionCode()));
    WriteRaw(g_hErr, msg, static_cast<DWORD>(std::strlen(msg)));
    MessageBoxA(nullptr, msg, "VLONE — crash", MB_ICONERROR | MB_OK);
    code = 99;
  }
  PauseExit();
  return code;
}
#else
int main() {
  int code = RunMainBody();
  PauseExit();
  return code;
}
#endif
