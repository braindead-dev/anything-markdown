const yaml = require("js-yaml");
const { fetch } = require("undici");
let ytDlpExec = null; try { ytDlpExec = require("yt-dlp-exec"); } catch {}
const { execFile } = require("child_process");

const DEBUG = process.env.AM_DEBUG === "1";
const log = (...args) => { if (DEBUG) console.log("[youtube]", ...args); };

function secondsToMmSs(t) {
  const tt = Math.max(0, Math.floor(parseFloat(t) || 0));
  const m = Math.floor(tt / 60);
  const s = Math.floor(tt % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isoFromUploadDate(uploadDate) {
  if (!uploadDate) return null;
  const s = String(uploadDate).trim();
  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    return `${y}-${m}-${d}T00:00:00+00:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return `${s.split("T")[0]}T00:00:00+00:00`;
  }
  return null;
}

function _safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

function normalizeYouTubeInput(input) {
  const raw = _safeDecode(String(input || "").trim());
  if (!raw) throw new Error("empty input");
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      const idParam = u.searchParams.get("v");
      if (idParam && /^[A-Za-z0-9_-]{11}$/.test(idParam)) {
        return { id: idParam, url: `https://www.youtube.com/watch?v=${idParam}` };
      }
      const pathId = (u.pathname || "").split("/").filter(Boolean).pop();
      if (pathId && /^[A-Za-z0-9_-]{11}$/.test(pathId)) {
        return { id: pathId, url: `https://www.youtube.com/watch?v=${pathId}` };
      }
    }
  } catch {}
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return { id: raw, url: `https://www.youtube.com/watch?v=${raw}` };
  }
  const m = raw.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{11})/);
  if (m && m[1]) {
    return { id: m[1], url: `https://www.youtube.com/watch?v=${m[1]}` };
  }
  throw new Error("Invalid YouTube ID or URL");
}

async function fetchInfoViaOembedAndHtml(url) {
  log("meta:start", url);
  let title = "", author = "", published_at = null;
  try {
    const o = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (o.ok) {
      const data = await o.json();
      title = (data.title || title).trim();
      author = (data.author_name || author).trim();
      log("oembed", { title: !!title, author: !!author });
    }
  } catch {}
  try {
    const r = await fetch(url, { headers: { "accept-language": "en-US,en;q=0.9" } });
    if (r.ok) {
      const html = await r.text();
      if (!title) {
        const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
        if (m && m[1]) title = m[1].trim();
      }
      const d = html.match(/itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i);
      if (d && d[1]) published_at = isoFromUploadDate(d[1].trim());
      if (!author) {
        const a = html.match(/"ownerChannelName"\s*:\s*"([^"]+)"/);
        if (a && a[1]) author = a[1].trim();
      }
      log("html_scrape", { title: !!title, author: !!author, published_at: !!published_at });
    }
  } catch {}
  return { title, author, url, published_at };
}

function parseVtt(text) {
  const lines = text.split(/\r?\n/);
  const cues = [];
  const timeRe = /^(\d{1,2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{1,2}:)?\d{2}:\d{2}\.\d{3}/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim(); i++;
    if (!timeRe.test(line)) continue;
    const parts = line.split("-->");
    const startStr = parts[0].trim();
    const endStr = (parts[1] || '').trim().split(/\s+/)[0] || startStr;
    const toSec = (s) => { const p = s.split(":"); return p.length === 3 ? (+p[0])*3600+(+p[1])*60+parseFloat(p[2]) : (+p[0])*60+parseFloat(p[1]); };
    const start = toSec(startStr);
    const end = toSec(endStr);
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "") { buf.push(lines[i].replace(/<[^>]+>/g, " ").trim()); i++; }
    while (i < lines.length && lines[i].trim() === "") i++;
    const textBuf = Array.from(new Set(buf)).join(" ").replace(/\s+/g, " ").trim();
    if (textBuf) cues.push({ start, end, text: textBuf });
  }
  return cues;
}

function parseTtml(ttml) {
  const segs = [];
  const unxml = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<br\s*\/?>/gi,' ');
  let re = /<text start="([^"]+)" dur="([^"]+)">([\s\S]*?)<\/text>/g; let m; let any=false;
  while ((m = re.exec(ttml)) !== null) { any=true; const start=parseFloat(m[1]); const dur=parseFloat(m[2]); const text=unxml(m[3].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()); if (text) segs.push({ start, end: start+dur, text }); }
  if (any) return segs;
  re = /<p[^>]*?t="(\d+)"[^>]*?(?:d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  while ((m = re.exec(ttml)) !== null) {
    const tMs = parseFloat(m[1] || '0'); const dMs = parseFloat(m[2] || '0');
    const inner = m[3]; let parts=[]; let sm; const sr=/<s[^>]*>([\s\S]*?)<\/s>/g;
    while ((sm = sr.exec(inner)) !== null) parts.push(sm[1]); if (!parts.length) parts=[inner];
    const text = unxml(parts.join(' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
    const start = tMs/1000.0; const end = (tMs + dMs)/1000.0; if (text) segs.push({ start, end, text });
  }
  return segs;
}

// Dedupe roll-up/duplicate cues without merging into long paragraphs.
function dedupeRollingCaptions(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const out = [];
  for (const seg of segments) {
    if (!seg) continue;
    const start = typeof seg.start === 'number' ? seg.start : 0;
    const end = typeof seg.end === 'number' ? seg.end : start;
    const text = String(seg.text || '').trim();
    if (!text) continue;
    if (out.length === 0) { out.push({ start, end, text }); continue; }
    const last = out[out.length - 1];
    // Exact duplicate text → skip
    if (text === last.text) { last.end = Math.max(last.end, end); continue; }
    // Roll-up duplicates often share (nearly) the same start time
    const sameStart = Math.abs(start - last.start) < 0.5;
    if (sameStart) {
      // Keep the longer text if one contains the other
      if (text.startsWith(last.text)) { last.text = text; last.end = Math.max(last.end, end); continue; }
      if (last.text.startsWith(text)) { last.end = Math.max(last.end, end); continue; }
    }
    out.push({ start, end, text });
  }
  return out;
}

async function listTimedTextTracks(videoId) {
  const url = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}&hl=en`;
  try { const r = await fetch(url, { headers: { Referer: `https://www.youtube.com/watch?v=${videoId}` } }); if (!r.ok) return []; const xml = await r.text(); const tracks = []; const re = /<track\b([^>]+)>/g; let m; while ((m = re.exec(xml)) !== null) { const attrs=m[1]; const ar=/(\w+)="([^"]*)"/g; let a; const entry={}; while((a=ar.exec(attrs))!==null){ entry[a[1]]=a[2]; } tracks.push(entry); } return tracks; } catch{ return []; }
}

async function fetchFromCaptionBaseUrl(baseUrl, refererUrl) {
  const headers = { Referer: refererUrl };
  try { const u1=new URL(baseUrl); u1.searchParams.set('fmt','vtt'); const r=await fetch(u1.toString(), { headers }); if (r.ok) { const vtt=await r.text(); const segs=parseVtt(vtt); if (segs.length) return segs; } } catch{}
  try { const u2=new URL(baseUrl); u2.searchParams.set('fmt','srv3'); const r=await fetch(u2.toString(), { headers }); if (r.ok) { const json=await r.text(); let obj=null; try { obj=JSON.parse(json); } catch{} if (obj && Array.isArray(obj.events)) { const segs=[]; for (const ev of obj.events) { const t=Number(ev.t||0)/1000.0; const d=Number(ev.d||0)/1000.0; const parts=(ev.segs||[]).map(s=>s.utf8||'').join(' ').replace(/\s+/g,' ').trim(); if (parts) segs.push({ start:t, end:t+d, text:parts }); } if (segs.length) return segs; } } } catch{}
  try { const r=await fetch(baseUrl, { headers }); if (r.ok) { const t=await r.text(); const segs=parseTtml(t); if (segs.length) return segs; } } catch{}
  return [];
}

async function fetchTimedTextVttByTrack(videoId, track) {
  const u = new URL("https://www.youtube.com/api/timedtext");
  u.searchParams.set("v", videoId);
  if (track.lang_code) u.searchParams.set("lang", track.lang_code);
  if ((track.kind||"").toLowerCase()==="asr") u.searchParams.set("kind", "asr");
  if (track.name) u.searchParams.set("name", track.name);
  const baseUrl = u.toString();
  const segs = await fetchFromCaptionBaseUrl(baseUrl, `https://www.youtube.com/watch?v=${videoId}`);
  return segs;
}

async function extractCaptionTracksFromWatchHtml(videoId) {
  try { const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`; const r = await fetch(url, { headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0" } }); if (!r.ok) return []; const html = await r.text(); const m = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/); if (!m) return []; const pr=JSON.parse(m[1]); const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []; return tracks; } catch{ return []; }
}

async function getYtDlpInfo(url) {
  if (ytDlpExec) { try { const res = await ytDlpExec(url, { dumpSingleJson: true, noWarnings: true, noCheckCertificates: true, skipDownload: true, simulate: true }); if (res && typeof res === 'object' && !('stdout' in res)) return res; const txt = (res && res.stdout) || res; return typeof txt === 'string' ? JSON.parse(txt) : txt; } catch{} }
  try { return await new Promise((resolve, reject) => { execFile('yt-dlp', ['-J', '--no-warnings', '--skip-download', url], { maxBuffer: 10*1024*1024 }, (err, stdout) => { if (err) return reject(err); try { resolve(JSON.parse(stdout)); } catch(e){ reject(e); } }); }); } catch{ return null; }
}

function pickTracksFromYtDlpInfo(info){ const caps = (info && (info.automatic_captions || info.subtitles)) || {}; const langs = Object.keys(caps); const order = [ 'en-orig', 'en', 'en-US', 'en-GB' ].concat(langs.filter(l=>/^en[-_]/i.test(l) && !['en','en-US','en-GB'].includes(l))); for (const lang of order){ const arr=caps[lang]; if (Array.isArray(arr)){ const vtt=arr.find(t => (t.ext||'').toLowerCase()==='vtt' && t.url); if (vtt) return { url: vtt.url, lang, kind: 'vtt' }; const any=arr.find(t=>t.url); if (any) return { url:any.url, lang, kind:any.ext||'unknown' }; } } for (const lang of langs){ const arr=caps[lang]; if(Array.isArray(arr)&&arr[0]?.url) return { url: arr[0].url, lang, kind: arr[0].ext||'unknown' }; } return null; }

async function fetchTranscriptViaYtDlp(idOrUrl){ try{ const { url } = normalizeYouTubeInput(idOrUrl); const info = await getYtDlpInfo(url); if (!info) return []; const pick = pickTracksFromYtDlpInfo(info); if (!pick) return []; let u = pick.url; try { const tmp = new URL(u); if (!tmp.searchParams.get('fmt')) tmp.searchParams.set('fmt','vtt'); u = tmp.toString(); } catch{} const r = await fetch(u, { headers: { Referer: url } }); if (!r.ok) return []; const text = await r.text(); let segs = parseVtt(text); if (!segs.length) segs = parseTtml(text); return segs; }catch{ return []; }}

async function fetchTranscript(idOrUrl) {
  const { id, url } = normalizeYouTubeInput(idOrUrl);
  log("transcript:start", { id });
  const viaDlp = await fetchTranscriptViaYtDlp(idOrUrl);
  if (viaDlp && viaDlp.length) return dedupeRollingCaptions(viaDlp);
  const htmlTracks = await extractCaptionTracksFromWatchHtml(id);
  if (Array.isArray(htmlTracks) && htmlTracks.length > 0) {
    const pick = htmlTracks.find((t) => (t.languageCode === 'en') || (t.vssId || '').includes('.en')) || htmlTracks[0];
    if (pick && pick.baseUrl) {
      const segs = await fetchFromCaptionBaseUrl(pick.baseUrl, url);
      if (segs.length) return dedupeRollingCaptions(segs);
    }
  }
  const listed = await listTimedTextTracks(id);
  if (listed.length > 0) {
    const score = (t)=>{ const lang=(t.lang_code||'').toLowerCase(); const vss=(t.vss_id||'').toLowerCase(); let s=0; if(lang==='en') s+=5; if(vss.includes('.en')||vss.includes('a.en')) s+=3; if((t.kind||'').toLowerCase()==='asr') s+=1; return s; };
    const sorted = listed.slice().sort((a,b)=>score(b)-score(a));
    for (const tr of sorted) { const segs = await fetchTimedTextVttByTrack(id, tr); if (segs.length) return dedupeRollingCaptions(segs); }
  }
  return [];
}

function composeBodyMarkdown(segments) { const lines = []; for (const s of segments) { const ts = secondsToMmSs(s.start || 0); const text = String(s.text || "").trim(); if (text) lines.push(`[${ts}] ${text}`); } lines.push(""); return lines.join("\n"); }

function frontmatter({ title, author, url, published_at }) { const meta = { title: title || "Untitled", author: author || null, url: url || null, published_at: published_at || null }; const header = yaml.dump(meta, { sortKeys: false }).trim(); return `---\n${header}\n---`; }

async function convertYouTubeToMarkdown(idOrUrl) { const { url } = normalizeYouTubeInput(idOrUrl); const meta = await fetchInfoViaOembedAndHtml(url); const segments = await fetchTranscript(idOrUrl); if (!segments || segments.length === 0) throw new Error("no transcript available"); const body = composeBodyMarkdown(segments); const fm = frontmatter(meta); return `${fm}\n\n${body}`.trim() + "\n"; }

module.exports = { convertYouTubeToMarkdown };
