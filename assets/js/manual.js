// assets/js/manual.js
(function () {
  console.log("manual.js v5 cargado"); // para comprobar versión en consola

  const form     = document.getElementById("manualForm");
  const inpNom   = document.getElementById("inpNombre");
  const inpRut   = document.getElementById("inpRut");
  const selLugar = document.getElementById("selLugar");
  const inpHora  = document.getElementById("inpHora");
  const btn      = document.getElementById("btnGuardar");

  const cfgEl   = document.getElementById("cfg");
  const API_URL = cfgEl?.dataset?.url || "/visitas/api/manual/";

  // CSRF desde el <form>
  const csrfInput = form.querySelector("input[name=csrfmiddlewaretoken]");
  const CSRF = csrfInput ? csrfInput.value : "";

  // --- Toast Bootstrap ---
  const toastEl   = document.getElementById("vsToast");
  const toastBody = document.getElementById("vsToastBody");
  const getToast  = (opts = {}) =>
    bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2200, ...opts });

  function notify(message, type = "success") {
    toastBody.textContent = message;
    toastEl.classList.remove(
      "text-bg-success",
      "text-bg-danger",
      "text-bg-warning",
      "text-bg-info"
    );
    toastEl.classList.add(
      type === "danger" ? "text-bg-danger" :
      type === "warning" ? "text-bg-warning" :
      type === "info"    ? "text-bg-info"    :
                           "text-bg-success"
    );
    getToast().show();
  }
  // ------------------------

  const trim = s => (s || "").toString().trim();

  // RegEx simple para el input (7 u 8 números + guión + dígito/K)
  const RUT_INPUT_RE = /^[0-9]{7,8}-[0-9kK]$/;

  // Validación ligera en el front al salir del campo
  inpRut.addEventListener("blur", () => {
    const raw = trim(inpRut.value);
    if (!raw) {
      inpRut.setCustomValidity("");
      inpRut.classList.remove("is-invalid", "is-valid");
      return;
    }

    if (!RUT_INPUT_RE.test(raw)) {
      inpRut.setCustomValidity(
        "Ingresa un RUT válido (ej: 12.345.678-9 o 12345678-9)."
      );
      inpRut.classList.remove("is-valid");
      inpRut.classList.add("is-invalid");
    } else {
      inpRut.setCustomValidity("");
      inpRut.classList.remove("is-invalid");
      inpRut.classList.add("is-valid");
    }
  });

  // Cuando el usuario edita el RUT, limpiamos el estado de error previo
  inpRut.addEventListener("input", () => {
    inpRut.setCustomValidity("");
    inpRut.classList.remove("is-invalid", "is-valid");
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    // limpiamos cualquier error custom anterior antes de validar
    inpRut.setCustomValidity("");

    form.classList.add("was-validated");
    if (!form.checkValidity()) {
      // Algún campo requerido/patrón falló
      return;
    }

    const payload = {
      nombre:     trim(inpNom.value),
      rut:        trim(inpRut.value),
      destino_id: selLugar.value ? Number(selLugar.value) : null,
      hora:       trim(inpHora.value) || null,   // HH:MM opcional
    };

    btn.disabled = true;
    btn.textContent = "Guardando...";

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": CSRF,
          "X-Requested-With": "fetch",
        },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") || "";
      const isJSON = ct.includes("application/json");
      const data = isJSON ? await res.json() : { ok: false, message: `Error ${res.status}` };

      if (!res.ok || !data.ok) {
        const msg = data.message || `Error ${res.status}`;
        notify(msg, "danger");

        // Si el backend dijo que el RUT es inválido, marcamos el input como inválido
        if (msg.includes("RUT no válido")) {
          inpRut.setCustomValidity("RUT no válido");
          inpRut.classList.remove("is-valid");
          inpRut.classList.add("is-invalid");
          form.classList.add("was-validated");
          inpRut.reportValidity();
          inpRut.focus();
        }

        return;
      }

      // Éxito
      inpRut.setCustomValidity("");
      inpRut.classList.remove("is-invalid");
      inpRut.classList.add("is-valid");

      notify("Ingreso manual registrado con éxito.", "success");
      form.reset();
      form.classList.remove("was-validated");
      inpRut.classList.remove("is-valid");
    } catch (err) {
      console.error(err);
      notify("Error de red o servidor.", "danger");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });
})();
