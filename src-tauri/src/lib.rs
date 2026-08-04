use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::net::UdpSocket;
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::task::JoinHandle;
use url::Url;
use uuid::Uuid;
use warp::http::{Method, StatusCode};
use warp::{Filter, Rejection, Reply};

const LAN_PORT: u16 = 53318;
const MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
const BROADCAST_ADDR: Ipv4Addr = Ipv4Addr::new(255, 255, 255, 255);
const PEER_TTL: Duration = Duration::from_secs(125);
const ANNOUNCE_INTERVAL: Duration = Duration::from_secs(5);
const MAX_LAN_BYTES: usize = 64 * 1024 * 1024;
const MAX_LLM_BYTES: usize = 40 * 1024 * 1024;
const MAX_LLM_RESPONSE_BYTES: usize = 40 * 1024 * 1024;
const MAX_MEDIA_BYTES: usize = 48 * 1024 * 1024;
const MAX_BACKUP_BYTES: usize = 128 * 1024 * 1024;
const PENDING_TTL: Duration = Duration::from_secs(125);
const MAX_PENDING_REQUESTS: usize = 64;
const MAX_PENDING_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone)]
struct AppState {
    data_root: PathBuf,
    client: reqwest::Client,
    lan: Arc<Mutex<Option<LanRuntime>>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedImageResult {
    mime_type: String,
    sha256: String,
    storage_path: String,
    local_uri: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadedImageResult {
    mime_type: String,
    data_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeletedResult {
    deleted: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenedFile {
    filename: String,
    mime_type: String,
    base64: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanPeer {
    fingerprint: String,
    alias: String,
    device_type: String,
    public_key: String,
    host: String,
    port: u16,
    last_seen: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanServiceInfo {
    alias: String,
    fingerprint: String,
    public_key: String,
    port: u16,
    transport: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeersChanged {
    peers: Vec<LanPeer>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequestEvent {
    request_id: String,
    envelope: String,
    peer_address: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Advertisement {
    app: String,
    version: u8,
    alias: String,
    #[serde(rename = "deviceType")]
    device_type: String,
    fingerprint: String,
    #[serde(rename = "publicKey")]
    public_key: String,
    port: u16,
    announce: bool,
}

#[derive(Clone)]
struct IncomingRequest {
    request_id: String,
    envelope: String,
    peer_address: Option<String>,
    delivered: bool,
    created_at: Instant,
}

#[derive(Clone)]
struct LanShared {
    alias: String,
    fingerprint: String,
    public_key: String,
    peers: Arc<RwLock<HashMap<String, LanPeerRecord>>>,
    incoming: Arc<RwLock<HashMap<String, IncomingRequest>>>,
    results: Arc<RwLock<HashMap<String, LanResult>>>,
    transfer_active: Arc<RwLock<bool>>,
}

#[derive(Clone)]
struct LanPeerRecord {
    peer: LanPeer,
    seen_at: Instant,
}

#[derive(Clone)]
struct LanResult {
    envelope: Option<String>,
    error: Option<String>,
}

struct LanRuntime {
    shared: LanShared,
    shutdown: Option<oneshot::Sender<()>>,
    tasks: Vec<JoinHandle<()>>,
    mdns: Option<ServiceDaemon>,
    mdns_fullname: Option<String>,
}

impl Drop for LanRuntime {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        for task in self.tasks.drain(..) {
            task.abort();
        }
        if let (Some(mdns), Some(fullname)) = (&self.mdns, &self.mdns_fullname) {
            let _ = mdns.unregister(fullname);
        }
    }
}

pub fn run() {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let data_root = exe_dir.join("CareJournalData");
    let webview_root = data_root.join("WebView2");
    let _ = std::fs::create_dir_all(&webview_root);

    let state = AppState {
        data_root: data_root.clone(),
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .redirect(Policy::none())
            .build()
            .expect("create http client"),
        lan: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(state)
        .setup(move |app| {
            std::fs::create_dir_all(data_root.join("media"))?;
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("CareJournal")
            .data_directory(webview_root.clone())
            .inner_size(1200.0, 820.0)
            .min_inner_size(900.0, 620.0)
            .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_persist_image,
            desktop_read_image,
            desktop_garbage_collect_images,
            desktop_save_file,
            desktop_open_file,
            desktop_llm_post,
            desktop_lan_start,
            desktop_lan_stop,
            desktop_lan_refresh,
            desktop_lan_list,
            desktop_lan_send,
            desktop_lan_complete,
            desktop_lan_reject,
            desktop_lan_set_transfer_active,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CareJournal");
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn media_dir(state: &AppState) -> PathBuf {
    state.data_root.join("media")
}

fn mime_extension(mime: &str) -> Result<&'static str, String> {
    match mime {
        "image/jpeg" => Ok("jpg"),
        "image/png" => Ok("png"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        "image/heic" => Ok("heic"),
        "image/heif" => Ok("heif"),
        "application/pdf" => Ok("pdf"),
        _ => Err("不支持的素材类型".into()),
    }
}

fn parse_data_url(data_url: &str, expected_mime: &str) -> Result<Vec<u8>, String> {
    let prefix = format!("data:{expected_mime};base64,");
    let encoded = data_url
        .strip_prefix(&prefix)
        .ok_or_else(|| "素材编码无效".to_string())?;
    let maximum_encoded = ((MAX_MEDIA_BYTES + 2) / 3) * 4;
    if encoded.len() > maximum_encoded {
        return Err("单个素材不能超过 48 MiB".into());
    }
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| "素材 Base64 无效".to_string())?;
    if bytes.len() > MAX_MEDIA_BYTES {
        return Err("单个素材不能超过 48 MiB".into());
    }
    Ok(bytes)
}

fn storage_to_path(state: &AppState, storage_path: &str) -> Result<PathBuf, String> {
    let normalized = storage_path.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains("..") || !normalized.starts_with("media/")
    {
        return Err("素材路径无效".into());
    }
    let path = state.data_root.join(&normalized);
    let root = media_dir(state).canonicalize().map_err(err)?;
    let parent = path.parent().ok_or_else(|| "素材路径无效".to_string())?;
    std::fs::create_dir_all(parent).map_err(err)?;
    let canonical_parent = parent.canonicalize().map_err(err)?;
    if !canonical_parent.starts_with(root) {
        return Err("素材路径越界".into());
    }
    if path.exists()
        && std::fs::symlink_metadata(&path)
            .map_err(err)?
            .file_type()
            .is_symlink()
    {
        return Err("素材路径无效".into());
    }
    Ok(path)
}

#[tauri::command]
async fn desktop_persist_image(
    state: tauri::State<'_, AppState>,
    id: String,
    mime_type: String,
    data_url: String,
    sha256: Option<String>,
) -> Result<PersistedImageResult, String> {
    let bytes = parse_data_url(&data_url, &mime_type)?;
    let digest = hex_sha256(&bytes);
    if let Some(expected) = sha256.as_deref() {
        if !expected.is_empty() && expected != digest {
            return Err("素材校验失败".into());
        }
    }
    let ext = mime_extension(&mime_type)?;
    let safe_id = sanitize_filename::sanitize(id);
    let filename = if safe_id.is_empty() {
        format!("{digest}.{ext}")
    } else {
        format!("{digest}-{safe_id}.{ext}")
    };
    let storage_path = format!("media/{filename}");
    let path = storage_to_path(&state, &storage_path)?;
    let temporary = path.with_extension(format!("{}.tmp", ext));
    tokio::fs::write(&temporary, &bytes).await.map_err(err)?;
    tokio::fs::rename(&temporary, &path).await.map_err(err)?;
    Ok(PersistedImageResult {
        mime_type,
        sha256: digest,
        storage_path,
        local_uri: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn desktop_read_image(
    state: tauri::State<'_, AppState>,
    storage_path: String,
) -> Result<LoadedImageResult, String> {
    let path = storage_to_path(&state, &storage_path)?;
    let metadata = tokio::fs::symlink_metadata(&path).await.map_err(err)?;
    if metadata.file_type().is_symlink() || metadata.len() > MAX_MEDIA_BYTES as u64 {
        return Err("素材文件无效或过大".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(err)?;
    let mime_type = mime_guess::from_path(&path)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_string();
    Ok(LoadedImageResult {
        data_url: format!("data:{mime_type};base64,{}", BASE64.encode(bytes)),
        mime_type,
    })
}

#[tauri::command]
async fn desktop_garbage_collect_images(
    state: tauri::State<'_, AppState>,
    storage_paths: Vec<String>,
) -> Result<DeletedResult, String> {
    let keep: std::collections::HashSet<String> = storage_paths.into_iter().collect();
    let mut deleted = 0;
    let mut entries = tokio::fs::read_dir(media_dir(&state)).await.map_err(err)?;
    while let Some(entry) = entries.next_entry().await.map_err(err)? {
        let name = entry.file_name().to_string_lossy().to_string();
        let storage = format!("media/{name}");
        if !keep.contains(&storage) && entry.file_type().await.map_err(err)?.is_file() {
            if tokio::fs::remove_file(entry.path()).await.is_ok() {
                deleted += 1;
            }
        }
    }
    Ok(DeletedResult { deleted })
}

#[tauri::command]
async fn desktop_save_file(
    filename: String,
    mime_type: String,
    base64: String,
) -> Result<String, String> {
    let maximum_encoded = ((MAX_BACKUP_BYTES + 2) / 3) * 4;
    if base64.len() > maximum_encoded {
        return Err("文件过大".into());
    }
    let bytes = BASE64
        .decode(base64)
        .map_err(|_| "文件编码无效".to_string())?;
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err("文件过大".into());
    }
    let safe = sanitize_filename::sanitize(filename);
    let path = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_file_name(if safe.is_empty() {
                "CareJournal.zip"
            } else {
                &safe
            })
            .save_file()
    })
    .await
    .map_err(err)?
    .ok_or_else(|| "用户取消保存".to_string())?;
    tokio::fs::write(&path, bytes).await.map_err(err)?;
    let _ = mime_type;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn desktop_open_file() -> Result<Option<OpenedFile>, String> {
    let path = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("CareJournal backup", &["zip", "json"])
            .pick_file()
    })
    .await
    .map_err(err)?;
    let Some(path) = path else { return Ok(None) };
    let metadata = tokio::fs::symlink_metadata(&path).await.map_err(err)?;
    if metadata.file_type().is_symlink() || metadata.len() > MAX_BACKUP_BYTES as u64 {
        return Err("备份文件无效或过大".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(err)?;
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "backup".into());
    let mime_type = mime_guess::from_path(&path)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_string();
    Ok(Some(OpenedFile {
        filename,
        mime_type,
        base64: BASE64.encode(bytes),
    }))
}

#[tauri::command]
async fn desktop_llm_post(
    state: tauri::State<'_, AppState>,
    url: String,
    headers: HashMap<String, String>,
    body: String,
    provider: String,
) -> Result<Value, String> {
    let target = validate_llm_url(&url, &provider)?;
    let mut request_headers = HeaderMap::new();
    request_headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let mut has_secret = false;
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if lower != "content-type" && lower != "authorization" && lower != "api-key" {
            continue;
        }
        if lower == "authorization" || lower == "api-key" {
            has_secret = true;
        }
        request_headers.insert(
            HeaderName::from_bytes(lower.as_bytes()).map_err(err)?,
            HeaderValue::from_str(&value).map_err(err)?,
        );
    }
    if !has_secret {
        return Ok(
            json!({ "ok": false, "status": 400, "data": { "error": { "message": "缺少 LLM API Key" } }, "detail": "缺少 LLM API Key" }),
        );
    }
    let bytes = body.into_bytes();
    if bytes.len() > MAX_LLM_BYTES {
        return Err("请求内容过大".into());
    }
    let response = state
        .client
        .post(target)
        .headers(request_headers)
        .body(bytes)
        .send()
        .await
        .map_err(err)?;
    let status = response.status();
    let status_code = status.as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_LLM_RESPONSE_BYTES as u64)
    {
        return Err("LLM 返回内容过大".into());
    }
    let response_bytes = response.bytes().await.map_err(err)?;
    if response_bytes.len() > MAX_LLM_RESPONSE_BYTES {
        return Err("LLM 返回内容过大".into());
    }
    let text = String::from_utf8_lossy(&response_bytes).to_string();
    let data = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text.clone()));
    Ok(json!({ "ok": status.is_success(), "status": status_code, "data": data, "detail": text }))
}

fn validate_llm_url(value: &str, provider: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| "API 地址无效".to_string())?;
    let hostname = url.host_str().unwrap_or_default().to_lowercase();
    if !url.username().is_empty() || url.password().is_some() {
        return Err("API 地址不能包含账号或密码".into());
    }
    if !url.path().to_lowercase().ends_with("/chat/completions") {
        return Err("LLM 请求路径无效".into());
    }
    if provider == "azure-openai" {
        let allowed = hostname.ends_with(".openai.azure.com")
            || hostname.ends_with(".cognitiveservices.azure.com")
            || hostname.ends_with(".services.ai.azure.com");
        if url.scheme() != "https"
            || !allowed
            || !port_ok(&url)
            || !url.path().to_lowercase().contains("/openai/v1/")
        {
            return Err("Azure OpenAI API 地址无效".into());
        }
        return Ok(url.to_string());
    }
    if provider == "openai-compatible" {
        let loopback = hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1";
        if url.scheme() != "https" && !(loopback && url.scheme() == "http") {
            return Err("自定义服务必须使用 HTTPS；本机回环地址可以使用 HTTP".into());
        }
        return Ok(url.to_string());
    }
    let allowed = match provider {
        "openai" => &["api.openai.com"][..],
        "deepseek" => &["api.deepseek.com"],
        "kimi" => &["api.moonshot.cn"],
        "doubao" => &["ark.cn-beijing.volces.com"],
        "qwen" => &["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"],
        "gemini" => &["generativelanguage.googleapis.com"],
        "minimax" => &["api.minimaxi.com"],
        "glm" => &["open.bigmodel.cn"],
        "openrouter" => &["openrouter.ai"],
        _ => &[],
    };
    if url.scheme() != "https" || !port_ok(&url) || !allowed.contains(&hostname.as_str()) {
        return Err("LLM 服务商与 API 地址不匹配".into());
    }
    Ok(url.to_string())
}

fn port_ok(url: &Url) -> bool {
    url.port().is_none() || url.port() == Some(443)
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
async fn desktop_lan_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    alias: String,
    public_key: String,
) -> Result<LanServiceInfo, String> {
    let alias = alias.chars().take(48).collect::<String>();
    if public_key.trim().is_empty() || public_key.len() > 240 {
        return Err("设备加密密钥无效".into());
    }
    let mut guard = state.lan.lock().await;
    *guard = None;
    let fingerprint = persistent_fingerprint(&state).await?;
    let shared = LanShared {
        alias: if alias.is_empty() {
            "CareJournal 桌面".into()
        } else {
            alias
        },
        fingerprint,
        public_key,
        peers: Arc::new(RwLock::new(HashMap::new())),
        incoming: Arc::new(RwLock::new(HashMap::new())),
        results: Arc::new(RwLock::new(HashMap::new())),
        transfer_active: Arc::new(RwLock::new(false)),
    };
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let mut tasks = Vec::new();
    tasks.push(spawn_udp(app.clone(), shared.clone(), shutdown_rx).await?);
    tasks.push(spawn_http(shared.clone()));
    let (mdns, fullname, mdns_task) = match start_mdns(app.clone(), shared.clone()) {
        Ok(parts) => parts,
        Err(_) => (None, None, None),
    };
    if let Some(task) = mdns_task {
        tasks.push(task);
    }
    let info = LanServiceInfo {
        alias: shared.alias.clone(),
        fingerprint: shared.fingerprint.clone(),
        public_key: shared.public_key.clone(),
        port: LAN_PORT,
        transport: "native".into(),
    };
    *guard = Some(LanRuntime {
        shared,
        shutdown: Some(shutdown_tx),
        tasks,
        mdns,
        mdns_fullname: fullname,
    });
    Ok(info)
}

#[tauri::command]
async fn desktop_lan_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    *state.lan.lock().await = None;
    Ok(())
}

#[tauri::command]
async fn desktop_lan_refresh(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let guard = state.lan.lock().await;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "局域网服务未启动".to_string())?;
    announce(&runtime.shared, true).await?;
    emit_peers(&app, &runtime.shared).await;
    Ok(())
}

#[tauri::command]
async fn desktop_lan_list(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let guard = state.lan.lock().await;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "局域网服务未启动".to_string())?;
    Ok(json!({ "peers": current_peers(&runtime.shared).await }))
}

#[tauri::command]
async fn desktop_lan_send(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    envelope: String,
) -> Result<Value, String> {
    if envelope.len() > MAX_LAN_BYTES {
        return Err("局域网请求过大".into());
    }
    let guard = state.lan.lock().await;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "局域网服务未启动".to_string())?;
    let known = current_peers(&runtime.shared)
        .await
        .into_iter()
        .any(|peer| peer.host == host && peer.port == port);
    if !known {
        return Err("目标设备不在当前发现列表中，请刷新后重试".into());
    }
    let local_alias = runtime.shared.alias.clone();
    let local_fingerprint = runtime.shared.fingerprint.clone();
    drop(guard);
    let safe_host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host
    };
    let base = format!("http://{safe_host}:{port}");
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .build()
        .map_err(err)?;
    let created = client
        .post(format!("{base}/carejournal/v1/sync"))
        .header(CONTENT_TYPE, "application/json")
        .header("X-CareJournal-Alias", local_alias)
        .header("X-CareJournal-Fingerprint", local_fingerprint)
        .timeout(Duration::from_secs(30))
        .body(envelope)
        .send()
        .await
        .map_err(err)?;
    if !created.status().is_success() {
        return Err(format!(
            "对方设备拒绝了同步请求（{}）",
            created.status().as_u16()
        ));
    }
    let request_id = created
        .json::<Value>()
        .await
        .map_err(err)?
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let result = client
            .get(format!("{base}/carejournal/v1/result/{request_id}"))
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(err)?;
        let status = result.status();
        let body = result.json::<Value>().await.map_err(err)?;
        if status.as_u16() == 202 {
            continue;
        }
        if !status.is_success() {
            return Err(body
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("对方设备未能完成同步")
                .into());
        }
        return Ok(
            json!({ "envelope": body.get("envelope").and_then(Value::as_str).unwrap_or_default() }),
        );
    }
    Err("等待对方完成同步超时".into())
}

#[tauri::command]
async fn desktop_lan_complete(
    state: tauri::State<'_, AppState>,
    request_id: String,
    envelope: String,
) -> Result<(), String> {
    if envelope.len() > MAX_LAN_BYTES {
        return Err("局域网请求过大".into());
    }
    let guard = state.lan.lock().await;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "局域网服务未启动".to_string())?;
    prune_pending(&runtime.shared).await;
    if !runtime
        .shared
        .incoming
        .read()
        .await
        .contains_key(&request_id)
    {
        return Err("同步请求已失效".into());
    }
    runtime.shared.results.write().await.insert(
        request_id,
        LanResult {
            envelope: Some(envelope),
            error: None,
        },
    );
    Ok(())
}

#[tauri::command]
async fn desktop_lan_reject(
    state: tauri::State<'_, AppState>,
    request_id: String,
    error: String,
) -> Result<(), String> {
    let guard = state.lan.lock().await;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "局域网服务未启动".to_string())?;
    prune_pending(&runtime.shared).await;
    if !runtime
        .shared
        .incoming
        .read()
        .await
        .contains_key(&request_id)
    {
        return Err("同步请求已失效".into());
    }
    runtime.shared.results.write().await.insert(
        request_id,
        LanResult {
            envelope: None,
            error: Some(if error.is_empty() {
                "对方拒绝同步".into()
            } else {
                error
            }),
        },
    );
    Ok(())
}

#[tauri::command]
async fn desktop_lan_set_transfer_active(
    state: tauri::State<'_, AppState>,
    active: bool,
) -> Result<(), String> {
    let guard = state.lan.lock().await;
    let runtime = guard
        .as_ref()
        .ok_or_else(|| "局域网服务未启动".to_string())?;
    *runtime.shared.transfer_active.write().await = active;
    Ok(())
}

async fn persistent_fingerprint(state: &AppState) -> Result<String, String> {
    let path = state.data_root.join("device-fingerprint.txt");
    if let Ok(value) = tokio::fs::read_to_string(&path).await {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return Ok(value);
        }
    }
    let value = Uuid::new_v4().to_string();
    tokio::fs::create_dir_all(&state.data_root)
        .await
        .map_err(err)?;
    tokio::fs::write(path, &value).await.map_err(err)?;
    Ok(value)
}

async fn spawn_udp(
    app: tauri::AppHandle,
    shared: LanShared,
    mut shutdown: oneshot::Receiver<()>,
) -> Result<JoinHandle<()>, String> {
    let std_socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, LAN_PORT)).map_err(err)?;
    std_socket.set_nonblocking(true).map_err(err)?;
    std_socket.set_broadcast(true).map_err(err)?;
    let _ = std_socket.join_multicast_v4(&MULTICAST_ADDR, &Ipv4Addr::UNSPECIFIED);
    let socket = Arc::new(UdpSocket::from_std(std_socket).map_err(err)?);
    announce_with_socket(&shared, &socket, true).await;
    let receive_socket = socket.clone();
    let announce_socket = socket.clone();
    Ok(tokio::spawn(async move {
        let mut buf = vec![0u8; 64 * 1024];
        let mut tick = tokio::time::interval(ANNOUNCE_INTERVAL);
        loop {
            tokio::select! {
                _ = &mut shutdown => break,
                _ = tick.tick() => {
                    announce_with_socket(&shared, &announce_socket, false).await;
                    emit_peers(&app, &shared).await;
                }
                received = receive_socket.recv_from(&mut buf) => {
                    if let Ok((len, remote)) = received {
                        if handle_advertisement(&app, &shared, &buf[..len], remote).await {
                            announce_with_socket(&shared, &announce_socket, false).await;
                        }
                    }
                }
            }
        }
    }))
}

fn spawn_http(shared: LanShared) -> JoinHandle<()> {
    tokio::spawn(async move {
        let shared_filter = warp::any().map(move || shared.clone());
        let sync = warp::path!("carejournal" / "v1" / "sync")
            .and(warp::post())
            .and(warp::header::exact_ignore_case(
                "content-type",
                "application/json",
            ))
            .and(warp::header::<String>("x-carejournal-fingerprint"))
            .and(warp::header::<String>("x-carejournal-alias"))
            .and(warp::body::content_length_limit(MAX_LAN_BYTES as u64))
            .and(warp::body::bytes())
            .and(warp::addr::remote())
            .and(shared_filter.clone())
            .and_then(handle_sync_http);
        let result = warp::path!("carejournal" / "v1" / "result" / String)
            .and(warp::get())
            .and(shared_filter.clone())
            .and_then(handle_result_http);
        let options = warp::options().map(|| warp::reply::with_status("", StatusCode::NO_CONTENT));
        let routes = sync.or(result).or(options).with(cors_headers());
        warp::serve(routes).run(([0, 0, 0, 0], LAN_PORT)).await;
    })
}

fn cors_headers() -> warp::cors::Builder {
    warp::cors()
        .allow_any_origin()
        .allow_headers(vec![
            "content-type",
            "x-carejournal-alias",
            "x-carejournal-fingerprint",
        ])
        .allow_methods(&[Method::GET, Method::POST, Method::OPTIONS])
}

async fn handle_sync_http(
    fingerprint: String,
    _alias: String,
    body: bytes::Bytes,
    remote: Option<SocketAddr>,
    shared: LanShared,
) -> Result<impl Reply, Rejection> {
    let envelope = String::from_utf8(body.to_vec()).map_err(|_| warp::reject())?;
    if fingerprint.is_empty()
        || fingerprint.len() > 128
        || serde_json::from_str::<Value>(&envelope).is_err()
    {
        return Err(warp::reject());
    }
    prune_pending(&shared).await;
    let incoming = shared.incoming.read().await;
    let pending_bytes: usize = incoming
        .values()
        .map(|request| request.envelope.len())
        .sum();
    if incoming.len() >= MAX_PENDING_REQUESTS
        || pending_bytes.saturating_add(envelope.len()) > MAX_PENDING_BYTES
    {
        return Err(warp::reject());
    }
    drop(incoming);
    let request_id = Uuid::new_v4().to_string();
    shared.incoming.write().await.insert(
        request_id.clone(),
        IncomingRequest {
            request_id: request_id.clone(),
            envelope,
            peer_address: remote.map(|addr| addr.ip().to_string()),
            delivered: false,
            created_at: Instant::now(),
        },
    );
    Ok(warp::reply::with_status(
        warp::reply::json(&json!({ "requestId": request_id })),
        StatusCode::ACCEPTED,
    ))
}

async fn handle_result_http(
    request_id: String,
    shared: LanShared,
) -> Result<impl Reply, Rejection> {
    prune_pending(&shared).await;
    let exists = shared.incoming.read().await.contains_key(&request_id);
    let result = shared.results.write().await.remove(&request_id);
    if result.is_some() {
        shared.incoming.write().await.remove(&request_id);
    }
    let reply = match result {
        None if exists => warp::reply::with_status(
            warp::reply::json(&json!({ "status": "pending" })),
            StatusCode::ACCEPTED,
        ),
        None => warp::reply::with_status(
            warp::reply::json(&json!({ "error": "同步请求已失效" })),
            StatusCode::GONE,
        ),
        Some(LanResult {
            error: Some(error), ..
        }) => warp::reply::with_status(
            warp::reply::json(&json!({ "error": error })),
            StatusCode::CONFLICT,
        ),
        Some(LanResult {
            envelope: Some(envelope),
            ..
        }) => warp::reply::with_status(
            warp::reply::json(&json!({ "envelope": envelope })),
            StatusCode::OK,
        ),
        Some(_) => warp::reply::with_status(
            warp::reply::json(&json!({ "error": "对方设备未能完成同步" })),
            StatusCode::CONFLICT,
        ),
    };
    Ok(reply)
}

async fn handle_advertisement(
    app: &tauri::AppHandle,
    shared: &LanShared,
    bytes: &[u8],
    remote: SocketAddr,
) -> bool {
    let Ok(ad) = serde_json::from_slice::<Advertisement>(bytes) else {
        return false;
    };
    if ad.app != "carejournal"
        || ad.version != 4
        || ad.public_key.is_empty()
        || ad.fingerprint == shared.fingerprint
    {
        return false;
    }
    let peer = LanPeer {
        fingerprint: ad.fingerprint.clone(),
        alias: if ad.alias.is_empty() {
            "CareJournal 设备".into()
        } else {
            ad.alias
        },
        device_type: if ad.device_type == "web" {
            "web".into()
        } else {
            "mobile".into()
        },
        public_key: ad.public_key,
        host: remote.ip().to_string(),
        port: if ad.port == 0 { LAN_PORT } else { ad.port },
        last_seen: now_ms(),
    };
    shared.peers.write().await.insert(
        ad.fingerprint,
        LanPeerRecord {
            peer,
            seen_at: Instant::now(),
        },
    );
    emit_peers(app, shared).await;
    ad.announce
}

async fn announce(shared: &LanShared, announce: bool) -> Result<(), String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(err)?;
    socket.set_broadcast(true).map_err(err)?;
    announce_with_socket(shared, &socket, announce).await;
    Ok(())
}

async fn announce_with_socket(shared: &LanShared, socket: &UdpSocket, announce: bool) {
    let payload = match serde_json::to_vec(&Advertisement {
        app: "carejournal".into(),
        version: 4,
        alias: shared.alias.clone(),
        device_type: "web".into(),
        fingerprint: shared.fingerprint.clone(),
        public_key: shared.public_key.clone(),
        port: LAN_PORT,
        announce,
    }) {
        Ok(payload) => payload,
        Err(_) => return,
    };
    let _ = socket.send_to(&payload, (MULTICAST_ADDR, LAN_PORT)).await;
    let _ = socket.send_to(&payload, (BROADCAST_ADDR, LAN_PORT)).await;
}

async fn current_peers(shared: &LanShared) -> Vec<LanPeer> {
    let mut peers = shared.peers.write().await;
    peers.retain(|_, record| record.seen_at.elapsed() <= PEER_TTL);
    let mut values = peers
        .values()
        .map(|record| {
            let mut peer = record.peer.clone();
            peer.last_seen = now_ms().saturating_sub(record.seen_at.elapsed().as_millis() as u64);
            peer
        })
        .collect::<Vec<_>>();
    values.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
    values
}

async fn emit_peers(app: &tauri::AppHandle, shared: &LanShared) {
    prune_pending(shared).await;
    let _ = app.emit(
        "desktop://peers-changed",
        PeersChanged {
            peers: current_peers(shared).await,
        },
    );
    let mut incoming = shared.incoming.write().await;
    for request in incoming.values_mut() {
        if !request.delivered && request.created_at.elapsed() <= Duration::from_secs(120) {
            request.delivered = true;
            let _ = app.emit(
                "desktop://sync-request",
                SyncRequestEvent {
                    request_id: request.request_id.clone(),
                    envelope: request.envelope.clone(),
                    peer_address: request.peer_address.clone(),
                },
            );
        }
    }
}

async fn prune_pending(shared: &LanShared) {
    shared
        .incoming
        .write()
        .await
        .retain(|_, request| request.created_at.elapsed() <= PENDING_TTL);
    let incoming = shared.incoming.read().await;
    shared
        .results
        .write()
        .await
        .retain(|request_id, _| incoming.contains_key(request_id));
}

fn start_mdns(
    app: tauri::AppHandle,
    shared: LanShared,
) -> Result<
    (
        Option<ServiceDaemon>,
        Option<String>,
        Option<JoinHandle<()>>,
    ),
    String,
> {
    let mdns = ServiceDaemon::new().map_err(err)?;
    let receiver = mdns.browse("_carejournal._tcp.local.").map_err(err)?;
    let hostname = hostname::get().map_err(err)?.to_string_lossy().to_string();
    let instance = format!(
        "CareJournal-{}",
        &shared.fingerprint[..8.min(shared.fingerprint.len())]
    );
    let service_type = "_carejournal._tcp.local.";
    let fullname = format!("{instance}.{service_type}");
    let mut props = HashMap::new();
    props.insert("app".to_string(), "carejournal".to_string());
    props.insert("v".to_string(), "4".to_string());
    props.insert("fp".to_string(), shared.fingerprint.clone());
    props.insert("pk".to_string(), shared.public_key.clone());
    props.insert("dt".to_string(), "web".to_string());
    props.insert("alias".to_string(), shared.alias.clone());
    let addrs = local_ipv4_addrs();
    let info = ServiceInfo::new(
        service_type,
        &instance,
        &hostname,
        addrs.as_slice(),
        LAN_PORT,
        props,
    )
    .map_err(err)?;
    mdns.register(info).map_err(err)?;
    let task = tokio::spawn(async move {
        while let Ok(event) = receiver.recv_async().await {
            if let ServiceEvent::ServiceResolved(info) = event {
                handle_mdns_service(&app, &shared, info).await;
            }
        }
    });
    Ok((Some(mdns), Some(fullname), Some(task)))
}

async fn handle_mdns_service(app: &tauri::AppHandle, shared: &LanShared, info: ServiceInfo) {
    let props = info.get_properties();
    let prop = |name: &str| {
        props
            .get_property_val_str(name)
            .map(|value| value.to_string())
            .unwrap_or_default()
    };
    if prop("app") != "carejournal" || prop("v") != "4" {
        return;
    }
    let fingerprint = prop("fp");
    let public_key = prop("pk");
    if fingerprint.is_empty() || public_key.is_empty() || fingerprint == shared.fingerprint {
        return;
    }
    let Some(host) = info.get_addresses().iter().find_map(|addr| match addr {
        IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
        _ => None,
    }) else {
        return;
    };
    let peer = LanPeer {
        fingerprint: fingerprint.clone(),
        alias: {
            let alias = prop("alias");
            if alias.is_empty() {
                "CareJournal 设备".into()
            } else {
                alias
            }
        },
        device_type: if prop("dt") == "web" {
            "web".into()
        } else {
            "mobile".into()
        },
        public_key,
        host,
        port: info.get_port(),
        last_seen: now_ms(),
    };
    shared.peers.write().await.insert(
        fingerprint,
        LanPeerRecord {
            peer,
            seen_at: Instant::now(),
        },
    );
    emit_peers(app, shared).await;
}

fn local_ipv4_addrs() -> Vec<IpAddr> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|iface| match iface.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() => Some(IpAddr::V4(ip)),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_known_provider_url() {
        assert!(validate_llm_url("https://api.openai.com/v1/chat/completions", "openai").is_ok());
        assert!(validate_llm_url("http://api.openai.com/v1/chat/completions", "openai").is_err());
        assert!(validate_llm_url("https://evil.example/v1/chat/completions", "openai").is_err());
    }

    #[test]
    fn validates_azure_url() {
        assert!(validate_llm_url(
            "https://demo.services.ai.azure.com/openai/v1/chat/completions",
            "azure-openai"
        )
        .is_ok());
        assert!(validate_llm_url(
            "https://demo.services.ai.azure.com/v1/chat/completions",
            "azure-openai"
        )
        .is_err());
    }

    #[test]
    fn custom_provider_allows_loopback_http_only() {
        assert!(validate_llm_url(
            "http://127.0.0.1:11434/v1/chat/completions",
            "openai-compatible"
        )
        .is_ok());
        assert!(validate_llm_url(
            "http://example.com/v1/chat/completions",
            "openai-compatible"
        )
        .is_err());
    }

    #[test]
    fn pending_result_requires_existing_request() {
        assert_eq!(MAX_PENDING_REQUESTS, 64);
        assert_eq!(PENDING_TTL, Duration::from_secs(125));
    }
}
