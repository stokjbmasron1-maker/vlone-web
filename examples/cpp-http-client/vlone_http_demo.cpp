#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#include <string>
#include <iostream>
#include <vector>

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "advapi32.lib")

static const wchar_t* kHost = L"vlone-web.vercel.app";
static const wchar_t* kVerifyPath = L"/api/verify";

static bool HttpsPostJson(
    const wchar_t* host,
    const wchar_t* path,
    const std::string& bodyUtf8,
    std::string& responseOut,
    DWORD& statusCodeOut) {
  responseOut.clear();
  statusCodeOut = 0;

  HINTERNET hSession =
      WinHttpOpen(L"VLONE-Client/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                  WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!hSession) return false;

  HINTERNET hConnect = WinHttpConnect(hSession, host, INTERNET_DEFAULT_HTTPS_PORT, 0);
  if (!hConnect) {
    WinHttpCloseHandle(hSession);
    return false;
  }

  HINTERNET hRequest = WinHttpOpenRequest(
      hConnect, L"POST", path, nullptr, WINHTTP_NO_REFERER,
      WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
  if (!hRequest) {
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return false;
  }

  std::wstring headers = L"Content-Type: application/json\r\n";
  WinHttpAddRequestHeaders(hRequest, headers.c_str(), static_cast<DWORD>(-1),
                           WINHTTP_ADDREQ_FLAG_ADD);

  DWORD len = static_cast<DWORD>(bodyUtf8.size());
  BOOL ok = WinHttpSendRequest(
      hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
      bodyUtf8.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<void*>(static_cast<const void*>(bodyUtf8.data())),
      len, len, 0);
  if (!ok) {
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return false;
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
    std::vector<char> chunk(avail);
    DWORD read = 0;
    if (!WinHttpReadData(hRequest, chunk.data(), avail, &read) || read == 0) break;
    responseOut.append(chunk.data(), read);
  }

  WinHttpCloseHandle(hRequest);
  WinHttpCloseHandle(hConnect);
  WinHttpCloseHandle(hSession);
  return true;
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

int main() {
  SetConsoleOutputCP(CP_UTF8);

  std::cout
      << "VLONE license check\n"
      << "--------------------\n"
      << "Flow:\n"
      << "  1) You enter the license key from the web dashboard.\n"
      << "  2) This app sends the key + this PC hardware id (HWID) to the server.\n"
      << "  3) Server checks the key is valid and not expired.\n"
      << "  4) If no device was linked yet, THIS device is registered.\n"
      << "  5) If the key is already linked to another HWID, verification fails.\n\n"
      << "HWID: Windows MachineGuid (registry) + prefix mg-. Fallback: PC name if unavailable.\n\n";

  std::cout << "Enter license key (from web dashboard, e.g. VLN-XXXXXXXX-MON): ";
  std::cout.flush();
  std::string license;
  if (!std::getline(std::cin, license)) {
    std::cerr << "ERROR: Could not read input.\n";
    return 1;
  }
  license = Trim(license);
  if (license.empty()) {
    std::cerr << "ERROR: License key cannot be empty.\n";
    return 1;
  }

  const std::string hwid = BuildHwidForApi();
  const std::string json =
      std::string("{\"key\":\"") + JsonEscape(license) + "\",\"hwid\":\"" + JsonEscape(hwid) + "\"}";

  std::string resp;
  DWORD httpStatus = 0;

  std::wcout << L"\nPOST https://" << kHost << kVerifyPath << L"\n";
  std::cout << "HWID sent: " << hwid << "\n";
  std::cout << "Request body: " << json << "\n\n";

  if (!HttpsPostJson(kHost, kVerifyPath, json, resp, httpStatus)) {
    std::cerr << "ERROR: Network request failed (WinHTTP).\n";
    return 1;
  }

  std::cout << "HTTP status: " << httpStatus << "\n";
  std::cout << "Raw JSON: " << resp << "\n\n";

  const bool valid = JsonBoolTrue(resp, "valid");
  const std::string apiMessage = JsonStringValue(resp, "message");
  const bool firstAct = JsonBoolTrue(resp, "first_activation");

  std::cout << "--- Result ---\n";
  if (valid) {
    std::cout << "STATUS: LICENSE OK\n";
    if (!apiMessage.empty()) std::cout << "Message: " << apiMessage << "\n";
    if (firstAct)
      std::cout << "Note: This device was just registered for this license key.\n";
    else
      std::cout << "Note: Device already matched; license checks out.\n";
  } else {
    std::cout << "STATUS: LICENSE FAILED\n";
    if (!apiMessage.empty())
      std::cout << "Message: " << apiMessage << "\n";
    else
      std::cout << "Message: (see raw JSON above)\n";
  }

  return valid ? 0 : 2;
}
