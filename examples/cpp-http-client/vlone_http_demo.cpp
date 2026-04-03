/**
 * VLONE — contoh client C++ (Windows) POST/GET pakai WinHTTP (built-in).
 *
 * Build (Developer Command Prompt / MSVC):
 *   cl /EHsc /std:c++17 vlone_http_demo.cpp /link winhttp.lib
 *
 * Atau g++ + libwinhttp (MSYS2):
 *   g++ -std=c++17 vlone_http_demo.cpp -lwinhttp -o vlone_http_demo.exe
 *
 * Run:
 *   vlone_http_demo.exe
 *
 * Edit kHost dan kVerifyPath di bawah sesuai domain Vercel kamu.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#include <string>
#include <iostream>
#include <vector>

#pragma comment(lib, "winhttp.lib")

// --- ganti ke domain deploy kamu (tanpa https://) ---
static const wchar_t* kHost = L"vlone-web.vercel.app";
static const wchar_t* kVerifyPath = L"/api/verify";
static const wchar_t* kGetPath = L"/store.html"; // contoh GET halaman statis

static bool HttpsRequest(
    const wchar_t* host,
    INTERNET_PORT port,
    const wchar_t* path,
    const wchar_t* method,          // L"GET" or L"POST"
    const std::string* bodyUtf8,    // null for GET
    std::string& responseOut,
    DWORD& statusCodeOut) {
  responseOut.clear();
  statusCodeOut = 0;

  HINTERNET hSession =
      WinHttpOpen(L"VLONE-CPP-Demo/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                  WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!hSession) return false;

  HINTERNET hConnect =
      WinHttpConnect(hSession, host, port, 0);
  if (!hConnect) {
    WinHttpCloseHandle(hSession);
    return false;
  }

  DWORD flags = WINHTTP_FLAG_SECURE;
  HINTERNET hRequest = WinHttpOpenRequest(
      hConnect, method, path, nullptr, WINHTTP_NO_REFERER,
      WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
  if (!hRequest) {
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return false;
  }

  std::wstring headers = L"Content-Type: application/json\r\n";
  WinHttpAddRequestHeaders(
      hRequest, headers.c_str(), static_cast<DWORD>(-1),
      WINHTTP_ADDREQ_FLAG_ADD);

  const void* optBody = WINHTTP_NO_REQUEST_DATA;
  DWORD optLen = 0;
  if (bodyUtf8 && !bodyUtf8->empty()) {
    optBody = bodyUtf8->data();
    optLen = static_cast<DWORD>(bodyUtf8->size());
  }

  BOOL ok = WinHttpSendRequest(
      hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, const_cast<void*>(optBody),
      optLen, optLen, 0);
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

int main() {
  SetConsoleOutputCP(CP_UTF8);

  std::cout << "=== VLONE HTTP demo (WinHTTP) ===\n\n";

  // ----- POST /api/verify (JSON) -----
  {
    std::string json = R"({"key":"VLN-XXXXXXXX-MON","hwid":"demo-pc-cpp-001"})";
    std::string resp;
    DWORD status = 0;

    std::wcout << L"[POST] https://" << kHost << kVerifyPath << L"\n";
    std::cout << "Body: " << json << "\n";

    if (!HttpsRequest(kHost, INTERNET_DEFAULT_HTTPS_PORT, kVerifyPath, L"POST",
                      &json, resp, status)) {
      std::cerr << "POST failed (WinHTTP error).\n";
    } else {
      std::cout << "HTTP status: " << status << "\n";
      std::cout << "Response:\n" << resp << "\n";
    }
    std::cout << "\n";
  }

  // ----- GET (contoh ambil HTML store — bukti koneksi GET) -----
  {
    std::string resp;
    DWORD status = 0;
    std::wcout << L"[GET] https://" << kHost << kGetPath << L"\n";

    if (!HttpsRequest(kHost, INTERNET_DEFAULT_HTTPS_PORT, kGetPath, L"GET",
                      nullptr, resp, status)) {
      std::cerr << "GET failed (WinHTTP error).\n";
    } else {
      std::cout << "HTTP status: " << status << "\n";
      std::cout << "Body length: " << resp.size() << " bytes";
      if (resp.size() > 200)
        std::cout << " (first 200 chars):\n" << resp.substr(0, 200) << "...\n";
      else
        std::cout << "\n" << resp << "\n";
    }
  }

  std::cout << "\nDone.\n";
  return 0;
}
