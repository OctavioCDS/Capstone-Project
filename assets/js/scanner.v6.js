// VisitaSegura – QR + OCR robusto (con miniatura autodestructible)

let STREAM = null;
let CODE_READER = null;
let MODAL = null;

let modalOpen = false;
let lastCodeText = "";
let lastScanTs = 0;
const COOLDOWN_MS = 3000;

const SNAPSHOT_TTL_MS = 12000; // <-- tiempo visible de la miniatura de la foto

const $ = (id) => document.getElementById(id);

// ---------------------- Mensajes ----------------------
let statusTimer = null;
function setStatus(msg, type = "secondary", sticky = false) {
  const box = $("result");
  if (!box) return;

  box.className = `alert alert-${type} mb-0`;
  box.textContent = msg;

  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  if (!sticky) {
    statusTimer = setTimeout(() => {
      box.className = "alert alert-secondary mb-0";
      box.textContent = "Cámara lista. Apunta al QR/Carnet.";
    }, 20000);
  }
}

function nowLocalYYYYMMDD_HHMMSS() {
  const now = new Date();
  const tz = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeRut(raw) {
  if (!raw) return "";
  const only = String(raw).replace(/[^0-9kK]/g, "").toUpperCase();
  if (only.length < 2) return only;
  return `${only.slice(0, -1)}-${only.slice(-1)}`;
}

function fillForm(payload) {
  const fRut = $("fRut");
  const fNombre = $("fNombre");
  const fFecha = $("fFecha");

  if (payload.rut && fRut) fRut.value = payload.rut;

  if (fNombre) {
    const nombreCompuesto = [payload.nombres, payload.apellidos]
      .filter(Boolean)
      .join(" ");
    fNombre.value = nombreCompuesto || fNombre.value || "";
  }

  if (fFecha) {
    fFecha.value = nowLocalYYYYMMDD_HHMMSS();
  }
}

function showModal() {
  const regModal = $("regModal");
  if (!MODAL) {
    MODAL = new bootstrap.Modal(regModal, {
      backdrop: "static",
      keyboard: false,
    });
  }
  modalOpen = true;
  MODAL.show();

  regModal.addEventListener(
    "hidden.bs.modal",
    () => {
      modalOpen = false;
    },
    { once: true }
  );
}

// ---------------------- Cámara ----------------------
async function ensureVideoPlaying(videoEl) {
  if (videoEl.readyState >= 2 && !videoEl.paused) return true;

  try {
    await videoEl.play();
  } catch (_) {}

  return videoEl.readyState >= 2 && !videoEl.paused;
}

async function startScanner(videoEl, deviceId = null) {
  const { BrowserMultiFormatReader } = ZXingBrowser;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("El navegador no permite acceso a la cámara.", "danger");
    return;
  }

  if (!CODE_READER) {
    CODE_READER = new BrowserMultiFormatReader();
  }

  // Detener si hay algo andando
  await stopScanner();

  // ---- MEJORAS DE CALIDAD / ENFOQUE ----
  // Pedimos 1080p ideal y autofocus continuo cuando el dispositivo lo soporte
  const constraints = deviceId
    ? {
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: "continuous",
        },
      }
    : {
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: "continuous",
        },
      };

  try {
    STREAM = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (_) {
    // Fallback muy básico si el navegador no soporta las constraints anteriores
    try {
      STREAM = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      setStatus("No se pudo iniciar la cámara.", "danger");
      return;
    }
  }

  // Intentar aplicar autofocus continuo si está disponible
  try {
    const track = STREAM.getVideoTracks()[0];
    const caps = track.getCapabilities?.();

    if (caps?.focusMode && caps.focusMode.includes("continuous")) {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" }],
      });
    }
  } catch (_) {
    // Si falla, simplemente seguimos con la configuración actual
  }

  videoEl.srcObject = STREAM;
  await ensureVideoPlaying(videoEl);

  // Preseleccionar cámara usada en el <select>
  try {
    const settings = STREAM.getVideoTracks()[0].getSettings();
    const usedId = settings.deviceId;
    const sel = $("camera-select");
    if (sel && usedId) {
      let opt = [...sel.options].find((o) => o.value === usedId);
      if (!opt) {
        opt = document.createElement("option");
        opt.value = usedId;
        opt.textContent = settings.label || "Cámara actual";
        sel.appendChild(opt);
      }
      sel.value = usedId;
    }
  } catch (_) {}

  CODE_READER.decodeFromVideoDevice(deviceId || undefined, videoEl, onDecode);
  setStatus("Cámara lista. Apunta al QR/Carnet.", "secondary", true);
}

async function stopScanner() {
  try {
    if (CODE_READER) {
      try {
        CODE_READER.reset();
      } catch (_) {}
    }

    if (STREAM) {
      STREAM.getTracks().forEach((t) => t.stop());
      STREAM = null;
    }

    const v = $("preview");
    if (v) {
      try {
        v.pause();
      } catch (_) {}
      v.srcObject = null;
    }

    // oculta la miniatura si está visible
    const thumb = $("snapshotThumb");
    if (thumb) {
      thumb.style.display = "none";
      thumb.src = "";
    }

    setStatus("Cámara detenida.", "secondary");
  } catch (_) {}
}

// ---------------------- QR ----------------------
function parseChileanIdQr(text) {
  const payload = { rut: "", nombres: "", apellidos: "" };
  if (!text) return payload;

  const raw = String(text).trim();

  // 1) Si parece URL con RUN=...
  try {
    const u = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, window.location.origin);

    const runParam =
      u.searchParams.get("RUN") ||
      u.searchParams.get("run") ||
      u.searchParams.get("Rut") ||
      u.searchParams.get("rut");

    if (runParam) {
      payload.rut = normalizeRut(decodeURIComponent(runParam));
      return payload;
    }
  } catch (_) {}

  // 2) RUN= en string plano (sin ser URL formal)
  const m = raw.match(/(?:^|[?&])(RUN|run|Rut|rut)=([^&]+)/);
  if (m && m[2]) {
    payload.rut = normalizeRut(decodeURIComponent(m[2]));
    return payload;
  }

  // 3) Formato con pipes: RUT|NOMBRES|APELLIDOS|...
  const parts = raw.split("|");
  if (parts.length >= 3) {
    payload.rut = normalizeRut(parts[0]);
    payload.nombres = parts[1]?.trim() || "";
    payload.apellidos = parts[2]?.trim() || "";
    return payload;
  }

  // 4) Cualquier cadena, buscar algo tipo 12345678-9
  const r2 = raw.match(/([0-9]{6,9}-?[0-9kK])/);
  payload.rut = r2 && r2[1] ? normalizeRut(r2[1]) : normalizeRut(raw);
  return payload;
}

async function onDecode(result) {
  if (!result) return;

  const now = Date.now();
  const text = result.getText ? result.getText() : result.text || "";
  if (!text) return;

  if (modalOpen) return;
  if (text === lastCodeText && now - lastScanTs < COOLDOWN_MS) return;

  lastCodeText = text;
  lastScanTs = now;

  const payload = parseChileanIdQr(text);
  if (!payload.rut) {
    setStatus("No se pudo leer un RUT válido.", "warning");
    return;
  }

  // Chequeo de duplicados / visita abierta (dry_run)
  try {
    const resp = await fetch(window.__scanApiUrl__, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": window.__csrfToken__,
      },
      body: JSON.stringify({ rut: payload.rut, dry_run: true }),
    });
    const data = await resp.json();
    if (data && data.inside === true) {
      setStatus("La persona ya se encuentra dentro (visita abierta).", "warning");
      return;
    }
  } catch (_) {}

  fillForm(payload);
  showModal();
}

// ---------------------- Captura / miniatura ----------------------
let thumbTimer = null;
function showTransientThumb(dataUrl) {
  const thumb = $("snapshotThumb");
  if (!thumb) return;

  thumb.src = dataUrl;
  thumb.style.display = "block";

  if (thumbTimer) {
    clearTimeout(thumbTimer);
    thumbTimer = null;
  }

  thumbTimer = setTimeout(() => {
    thumb.style.display = "none";
    thumb.src = "";
  }, SNAPSHOT_TTL_MS);
}

function captureFrame() {
  const video = $("preview");
  const canvas = $("snapshotCanvas");
  if (!video || !canvas) return null;

  const w = video.videoWidth || 1920;
  const h = video.videoHeight || 1080;
  if (w === 0 || h === 0) return null;

  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);

  // mostrar miniatura temporal
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  showTransientThumb(dataUrl);

  return { canvas, width: w, height: h };
}

// ---------------------- Mejora imagen ----------------------
function enhanceToDataURL(
  srcCanvas,
  x,
  y,
  w,
  h,
  scale = 2,
  rotate180 = false,
  threshold = null,
  contrast = 1.35
) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.floor(w * scale));
  out.height = Math.max(1, Math.floor(h * scale));

  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  if (!rotate180) {
    octx.drawImage(srcCanvas, x, y, w, h, 0, 0, out.width, out.height);
  } else {
    octx.translate(out.width, out.height);
    octx.rotate(Math.PI);
    octx.drawImage(srcCanvas, x, y, w, h, 0, 0, out.width, out.height);
    octx.setTransform(1, 0, 0, 1, 0, 0);
  }

  const img = octx.getImageData(0, 0, out.width, out.height);
  const data = img.data;
  const shift = 128 * (1 - contrast);

  for (let i = 0; i < data.length; i += 4) {
    const g =
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let v = g * contrast + shift;
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  if (threshold !== null) {
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] >= threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }

  octx.putImageData(img, 0, 0);
  return out.toDataURL("image/png");
}

// ---------------------- OCR helpers ----------------------
function extractRut(text) {
  if (!text) return "";
  const line = text.split(/\n/).find((l) => /R\.?U\.?N|RUT/i.test(l)) || "";
  const hay = (line || text).replace(/[^\dKk\-]/g, "");
  const m = hay.match(/([0-9]{6,9}-?[0-9Kk])/);
  return m ? normalizeRut(m[1]) : "";
}

function extractName(text) {
  const stop = new Set([
    "REPUBLICA",
    "DE",
    "CHILE",
    "CEDULA",
    "IDENTIDAD",
    "CHILENA",
    "NACIONALIDAD",
    "RUN",
    "R.U.N",
    "RUT",
    "NUMEROS",
    "APELLIDO",
    "APELLIDOS",
    "NOMBRES",
    "SEXO",
    "VENCIMIENTO",
    "EMISION",
    "FIRMA",
    "TITULAR",
    "DOCUMENTO",
  ]);

  const lines = (text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const candidates = lines
    .map((l) =>
      l
        .replace(/[^\p{L}\sÁÉÍÓÚÑ]/giu, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter((l) => l.length >= 4)
    .map((l) => l.toUpperCase())
    .filter((l) => l.split(/\s+/).every((w) => w.length <= 2 || !stop.has(w)));

  let best = "";
  for (const l of candidates) {
    if (/^[A-ZÁÉÍÓÚÑ\s]+$/.test(l) && l.length > best.length) {
      best = l;
    }
  }
  return best ? best.replace(/\s+/g, " ").trim() : "";
}

async function tesseract(url, lang, opts = {}) {
  try {
    const res = await Tesseract.recognize(url, lang, opts);
    return res?.data?.text || "";
  } catch (_) {
    return "";
  }
}

// --- OCR RUN robusto (banda inferior-izquierda) ---
async function ocrRunRobusto(shot, langs) {
  const W = shot.width;
  const H = shot.height;

  const bandH = Math.floor(H * 0.18);
  const y0 = H - bandH;

  const crops = [
    { x: Math.floor(W * 0.02), y: y0, w: Math.floor(W * 0.5), h: bandH },
    { x: Math.floor(W * 0.05), y: y0, w: Math.floor(W * 0.6), h: bandH },
    { x: Math.floor(W * 0.08), y: y0, w: Math.floor(W * 0.7), h: bandH },
  ];

  const thresholds = [null, 140, 160, 180];

  for (const rotate of [false, true]) {
    for (const c of crops) {
      for (const th of thresholds) {
        const url = enhanceToDataURL(
          shot.canvas,
          c.x,
          c.y,
          c.w,
          c.h,
          2.2,
          rotate,
          th,
          1.4
        );

        for (const lang of langs) {
          const txt = await tesseract(url, lang, {
            psm: 7,
            tessedit_char_whitelist: "0123456789Kk- RUTRUN.",
          });

          const rut = extractRut(txt);
          if (rut) return rut;
        }
      }
    }
  }

  return "";
}

async function ocrNombreGlobal(shot, langs) {
  for (const lang of langs) {
    const text = await tesseract(
      shot.canvas.toDataURL("image/png"),
      lang,
      { psm: 6 }
    );
    if (text && text.trim()) {
      const name = extractName(text);
      if (name) return name;
    }
  }
  return "";
}

// ---------------------- OCR desde snapshot ----------------------
async function runOcrFromSnapshot() {
  const video = $("preview");
  const ok = await ensureVideoPlaying(video);
  if (!ok) {
    setStatus("La cámara no está lista para capturar.", "warning");
    return;
  }

  const shot = captureFrame();
  if (!shot) {
    setStatus("No fue posible capturar la imagen.", "danger");
    return;
  }

  setStatus("Procesando OCR…", "info");

  const langs = (window.__ocrLang || "eng")
    .split(",")
    .map((s) => s.trim());

  const rut = await ocrRunRobusto(shot, langs);

  if (!rut) {
    setStatus("No se pudo extraer el RUT mediante OCR.", "warning");
    return;
  }

  // DRY-RUN duplicados
  try {
    const resp = await fetch(window.__scanApiUrl__, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": window.__csrfToken__,
      },
      body: JSON.stringify({ rut, dry_run: true }),
    });
    const preview = await resp.json();
    if (preview && preview.inside === true) {
      setStatus("La persona ya se encuentra dentro (visita abierta).", "warning");
      return;
    }
  } catch (_) {}

  const nombre = await ocrNombreGlobal(shot, langs);
  fillForm({ rut, nombres: nombre, apellidos: "" });

  setStatus("Datos extraídos por OCR. Verifica antes de registrar.", "success");
  showModal();
}

// ---------------------- Registro ----------------------
async function handleRegister(apiUrl, csrfToken) {
  const body = {
    rut: $("fRut")?.value?.trim() || "",
    nombre: $("fNombre")?.value?.trim() || "",
    fecha_hora: $("fFecha")?.value?.trim() || "",
    destino_id: $("fDestino")?.value
      ? Number($("fDestino").value)
      : null,
    dry_run: false,
  };

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(body),
  });

  let msg = "Registro realizado";
  let type = "success";

  try {
    const data = await resp.json();
    if (data?.message) msg = data.message;
    if (!data?.ok) type = "warning";
  } catch (_) {}

  const regForm = $("regForm");
  if (regForm) regForm.reset();
  if (MODAL) MODAL.hide();

  // oculta miniatura al confirmar/cancelar registro
  const thumb = $("snapshotThumb");
  if (thumb) {
    thumb.style.display = "none";
    thumb.src = "";
  }

  setStatus(msg, type);
  lastScanTs = Date.now();
}

function handleCancel() {
  if (MODAL) MODAL.hide();

  const thumb = $("snapshotThumb");
  if (thumb) {
    thumb.style.display = "none";
    thumb.src = "";
  }

  lastScanTs = Date.now();
  setStatus("Registro cancelado.", "secondary");
}

// ---------------------- Init ----------------------
function populateCameraSelect(sel) {
  if (!sel || !navigator.mediaDevices?.enumerateDevices) return;

  navigator.mediaDevices
    .enumerateDevices()
    .then((devs) => {
      const cams = devs.filter((d) => d.kind === "videoinput");
      if (sel.options.length <= 1) {
        cams.forEach((d, i) => {
          const opt = document.createElement("option");
          opt.value = d.deviceId;
          opt.textContent = d.label || `Cámara ${i + 1}`;
          sel.appendChild(opt);
        });
      }
    })
    .catch(() => {});
}

window.initScanner = function initScanner({
  apiUrl,
  csrfToken,
  autoStart = true,
  ocrLang = "eng",
}) {
  window.__scanApiUrl__ = apiUrl;
  window.__csrfToken__ = csrfToken;
  window.__ocrLang = ocrLang;

  const preview = $("preview");
  const camSel = $("camera-select");
  const btnScan = $("btnScan");
  const btnStop = $("btnStop");
  const btnSnapshot = $("btnSnapshot");
  const btnRegistrar = $("btnRegistrar");
  const btnCancel = $("btnCancel");

  populateCameraSelect(camSel);

  if (btnScan)
    btnScan.addEventListener("click", () =>
      startScanner(preview, camSel?.value || null)
    );

  if (btnStop) btnStop.addEventListener("click", stopScanner);
  if (btnSnapshot) btnSnapshot.addEventListener("click", runOcrFromSnapshot);
  if (btnRegistrar)
    btnRegistrar.addEventListener("click", () =>
      handleRegister(apiUrl, csrfToken)
    );
  if (btnCancel) btnCancel.addEventListener("click", handleCancel);

  setStatus("Cámara lista. Apunta al QR/Carnet.", "secondary", true);

  if (autoStart && preview) {
    startScanner(preview, camSel?.value || null);
  }
};
