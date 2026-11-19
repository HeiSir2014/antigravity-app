use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Minimal Zero-Dependency Protobuf Wire Encoder / Decoder for boq-jetski
// ============================================================================

fn write_varint(buf: &mut Vec<u8>, mut v: u64) {
    loop {
        let byte = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            buf.push(byte);
            break;
        } else {
            buf.push(byte | 0x80);
        }
    }
}

fn read_varint(data: &[u8], pos: &mut usize) -> Result<u64, String> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    while *pos < data.len() {
        let byte = data[*pos];
        *pos += 1;
        result |= ((byte & 0x7f) as u64) << shift;
        if (byte & 0x80) == 0 {
            return Ok(result);
        }
        shift += 7;
        if shift >= 64 {
            return Err("Protobuf varint overflow".to_string());
        }
    }
    Err("Unexpected EOF reading protobuf varint".to_string())
}

fn write_length_delimited(buf: &mut Vec<u8>, field_num: u32, bytes: &[u8]) {
    write_varint(buf, ((field_num as u64) << 3) | 2);
    write_varint(buf, bytes.len() as u64);
    buf.extend_from_slice(bytes);
}

fn read_length_delimited<'a>(data: &'a [u8], pos: &mut usize) -> Result<&'a [u8], String> {
    let len = read_varint(data, pos)? as usize;
    if *pos + len > data.len() {
        return Err("Unexpected EOF reading protobuf length-delimited field".to_string());
    }
    let slice = &data[*pos..*pos + len];
    *pos += len;
    Ok(slice)
}

fn skip_field(data: &[u8], pos: &mut usize, wire_type: u8) -> Result<(), String> {
    match wire_type {
        0 => {
            let _ = read_varint(data, pos)?;
        }
        1 => {
            if *pos + 8 > data.len() {
                return Err("EOF skipping 64-bit field".to_string());
            }
            *pos += 8;
        }
        2 => {
            let _ = read_length_delimited(data, pos)?;
        }
        5 => {
            if *pos + 4 > data.len() {
                return Err("EOF skipping 32-bit field".to_string());
            }
            *pos += 4;
        }
        _ => return Err(format!("Unsupported protobuf wire type: {wire_type}")),
    }
    Ok(())
}

// ============================================================================
// boq-jetski ApiService Messages
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInstance {
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub account_label: String,
    pub uuid: String,
    pub display_name: String,
    pub version: String,
    pub supports_chunking: bool,
    pub status: String, // "RUNNING" | "IDLE" | "DISCONNECTED"
    pub last_active_ms: u64,
}

pub fn encode_list_instances_request(project: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    if !project.is_empty() {
        write_length_delimited(&mut buf, 1, project.as_bytes());
    }
    buf
}

fn decode_instance_metadata(data: &[u8]) -> (String, String, bool) {
    let mut pos = 0;
    let mut name = String::new();
    let mut version = String::new();
    let mut supports_chunking = false;
    while pos < data.len() {
        let Ok(tag) = read_varint(data, &mut pos) else {
            break;
        };
        let field = (tag >> 3) as u32;
        let wire = (tag & 0x7) as u8;
        match (field, wire) {
            (1, 2) => {
                if let Ok(b) = read_length_delimited(data, &mut pos) {
                    name = String::from_utf8_lossy(b).to_string();
                }
            }
            (2, 2) => {
                if let Ok(b) = read_length_delimited(data, &mut pos) {
                    version = String::from_utf8_lossy(b).to_string();
                }
            }
            (3, 0) => {
                if let Ok(v) = read_varint(data, &mut pos) {
                    supports_chunking = v != 0;
                }
            }
            _ => {
                if skip_field(data, &mut pos, wire).is_err() {
                    break;
                }
            }
        }
    }
    (name, version, supports_chunking)
}

fn decode_timestamp_ms(data: &[u8]) -> u64 {
    let mut pos = 0;
    let mut seconds = 0u64;
    let mut nanos = 0u64;
    while pos < data.len() {
        let Ok(tag) = read_varint(data, &mut pos) else {
            break;
        };
        let field = (tag >> 3) as u32;
        let wire = (tag & 0x7) as u8;
        match (field, wire) {
            (1, 0) => {
                if let Ok(v) = read_varint(data, &mut pos) {
                    seconds = v;
                }
            }
            (2, 0) => {
                if let Ok(v) = read_varint(data, &mut pos) {
                    nanos = v;
                }
            }
            _ => {
                if skip_field(data, &mut pos, wire).is_err() {
                    break;
                }
            }
        }
    }
    seconds.saturating_mul(1000) + (nanos / 1_000_000)
}

fn decode_instance_details(data: &[u8]) -> Option<DeviceInstance> {
    let mut pos = 0;
    let mut uuid = String::new();
    let mut display_name = String::new();
    let mut version = String::from("v2");
    let mut supports_chunking = false;
    let mut status_code = 0u64;
    let mut last_active_ms = 0u64;

    while pos < data.len() {
        let Ok(tag) = read_varint(data, &mut pos) else {
            break;
        };
        let field = (tag >> 3) as u32;
        let wire = (tag & 0x7) as u8;
        match (field, wire) {
            (1, 2) => {
                if let Ok(b) = read_length_delimited(data, &mut pos) {
                    uuid = String::from_utf8_lossy(b).to_string();
                }
            }
            (2, 2) => {
                if let Ok(b) = read_length_delimited(data, &mut pos) {
                    let (n, v, sc) = decode_instance_metadata(b);
                    if !n.is_empty() {
                        display_name = n;
                    }
                    if !v.is_empty() {
                        version = v;
                    }
                    supports_chunking = sc;
                }
            }
            (3, 0) => {
                if let Ok(v) = read_varint(data, &mut pos) {
                    status_code = v;
                }
            }
            (4, 2) => {
                if let Ok(b) = read_length_delimited(data, &mut pos) {
                    last_active_ms = decode_timestamp_ms(b);
                }
            }
            _ => {
                if skip_field(data, &mut pos, wire).is_err() {
                    break;
                }
            }
        }
    }

    if uuid.is_empty() {
        return None;
    }

    if display_name.is_empty() {
        display_name = format!("Host ({})", &uuid[..uuid.len().min(8)]);
    }

    let status = match status_code {
        1 => "RUNNING",
        2 => "IDLE",
        _ => "DISCONNECTED",
    }
    .to_string();

    Some(DeviceInstance {
        account_id: String::new(),
        account_label: String::new(),
        uuid,
        display_name,
        version,
        supports_chunking,
        status,
        last_active_ms,
    })
}

pub fn decode_list_instances_response(data: &[u8]) -> Result<Vec<DeviceInstance>, String> {
    let mut pos = 0;
    let mut instances = Vec::new();
    while pos < data.len() {
        let tag = read_varint(data, &mut pos)?;
        let field = (tag >> 3) as u32;
        let wire = (tag & 0x7) as u8;
        match (field, wire) {
            (1, 2) => {
                let entry_bytes = read_length_delimited(data, &mut pos)?;
                if let Some(inst) = decode_instance_details(entry_bytes) {
                    instances.push(inst);
                }
            }
            _ => skip_field(data, &mut pos, wire)?,
        }
    }
    Ok(instances)
}

pub fn encode_proxy_command_request(
    target_instance_uuid: &str,
    rpc_path: &str,
    payload: &[u8],
    headers: &HashMap<String, String>,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(payload.len() + 128);
    if !target_instance_uuid.is_empty() {
        write_length_delimited(&mut buf, 1, target_instance_uuid.as_bytes());
    }
    if !rpc_path.is_empty() {
        write_length_delimited(&mut buf, 2, rpc_path.as_bytes());
    }
    if !payload.is_empty() {
        write_length_delimited(&mut buf, 3, payload);
    }
    for (k, v) in headers {
        let mut entry = Vec::with_capacity(k.len() + v.len() + 8);
        write_length_delimited(&mut entry, 1, k.as_bytes());
        write_length_delimited(&mut entry, 2, v.as_bytes());
        write_length_delimited(&mut buf, 4, &entry);
    }
    buf
}

#[derive(Debug, Clone)]
pub struct ProxyCommandResponse {
    pub payload: Vec<u8>,
    #[allow(dead_code)]
    pub headers: HashMap<String, String>,
}

fn decode_map_entry(data: &[u8]) -> Option<(String, String)> {
    let mut pos = 0;
    let mut key = String::new();
    let mut val = String::new();
    while pos < data.len() {
        let Ok(tag) = read_varint(data, &mut pos) else {
            break;
        };
        let field = (tag >> 3) as u32;
        let wire = (tag & 0x7) as u8;
        match (field, wire) {
            (1, 2) => {
                if let Ok(b) = read_length_delimited(data, &mut pos) {
                    key = String::from_utf8_lossy(b).to_string();
                }
            }
            (2, 2) => {
                if let Ok(b) = read_length_delimited(data, &mut pos) {
                    val = String::from_utf8_lossy(b).to_string();
                }
            }
            _ => {
                if skip_field(data, &mut pos, wire).is_err() {
                    break;
                }
            }
        }
    }
    if key.is_empty() {
        None
    } else {
        Some((key, val))
    }
}

pub fn decode_proxy_command_response(data: &[u8]) -> Result<ProxyCommandResponse, String> {
    let mut pos = 0;
    let mut payload = Vec::new();
    let mut headers = HashMap::new();
    while pos < data.len() {
        let tag = read_varint(data, &mut pos)?;
        let field = (tag >> 3) as u32;
        let wire = (tag & 0x7) as u8;
        match (field, wire) {
            (1, 2) => {
                let b = read_length_delimited(data, &mut pos)?;
                payload = b.to_vec();
            }
            (2, 2) => {
                let entry_bytes = read_length_delimited(data, &mut pos)?;
                if let Some((k, v)) = decode_map_entry(entry_bytes) {
                    headers.insert(k, v);
                }
            }
            _ => skip_field(data, &mut pos, wire)?,
        }
    }
    Ok(ProxyCommandResponse { payload, headers })
}

// ============================================================================
// gRPC-Web & Connect Binary Framing (5-byte envelope)
// ============================================================================

pub fn encode_grpc_web_frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(5 + payload.len());
    frame.push(0x00); // uncompressed data frame
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

#[derive(Debug)]
pub enum GrpcWebFrame {
    Data(Vec<u8>),
    Trailers(HashMap<String, String>),
}

#[derive(Default)]
pub struct GrpcWebDecoder {
    buf: Vec<u8>,
}

impl GrpcWebDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<GrpcWebFrame> {
        self.buf.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while self.buf.len() >= 5 {
            let flags = self.buf[0];
            let len = u32::from_be_bytes([self.buf[1], self.buf[2], self.buf[3], self.buf[4]]) as usize;
            if self.buf.len() < 5 + len {
                break;
            }
            let body = self.buf[5..5 + len].to_vec();
            self.buf.drain(..5 + len);

            if (flags & 0x80) != 0 {
                let text = String::from_utf8_lossy(&body);
                let mut trailers = HashMap::new();
                for line in text.lines() {
                    if let Some((k, v)) = line.split_once(':') {
                        trailers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
                    }
                }
                frames.push(GrpcWebFrame::Trailers(trailers));
            } else {
                frames.push(GrpcWebFrame::Data(body));
            }
        }
        frames
    }
}

/// Extracts UTF-8 JSON payloads from Connect-enveloped or raw JSON stream chunks.
pub fn extract_connect_or_raw_json(payload: &[u8]) -> Vec<serde_json::Value> {
    if payload.is_empty() {
        return Vec::new();
    }
    // Try raw JSON first
    if payload[0] == b'{' || payload[0] == b'[' {
        if let Ok(val) = serde_json::from_slice::<serde_json::Value>(payload) {
            return vec![val];
        }
    }
    // Otherwise parse Connect 5-byte frames: [flags: u8, len: be_u32, json_bytes]
    let mut results = Vec::new();
    let mut offset = 0usize;
    while offset + 5 <= payload.len() {
        let len = u32::from_be_bytes([
            payload[offset + 1],
            payload[offset + 2],
            payload[offset + 3],
            payload[offset + 4],
        ]) as usize;
        if offset + 5 + len > payload.len() {
            break;
        }
        let body = &payload[offset + 5..offset + 5 + len];
        if let Ok(val) = serde_json::from_slice::<serde_json::Value>(body) {
            results.push(val);
        }
        offset += 5 + len;
    }
    results
}
