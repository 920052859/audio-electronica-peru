#!/usr/bin/env node
/**
 * Migración FormSubmit → Backend propio
 *
 * Este script toma el HTML actual (que usa FormSubmit) y lo convierte
 * en una versión conectada a tu backend Node.js.
 *
 * Cambios que hace:
 *   1. Reemplaza CONFIG con una sección BACKEND apuntando a tu API
 *   2. Cambia las llamadas fetch(FORMSUBMIT) por fetch(API + endpoints)
 *   3. Agrega función loadProductsFromAPI() que reemplaza el array hardcoded
 *   4. Maneja respuestas 409 (stock insuficiente) con UI amigable
 *
 * USO:
 *   node migrate-to-backend.js \
 *     --input  audio-electronica.html \
 *     --output audio-electronica-connected.html \
 *     --api    https://audio-electronica-api.onrender.com
 */
const fs = require('fs');
const path = require('path');

// ==== Parse args ====
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

const INPUT  = args.input  || 'audio-electronica.html';
const OUTPUT = args.output || 'audio-electronica-connected.html';
const API    = args.api    || 'https://tu-backend.onrender.com';

if (!fs.existsSync(INPUT)) {
  console.error(`❌ No existe: ${INPUT}`);
  process.exit(1);
}

let html = fs.readFileSync(INPUT, 'utf8');

// ==== 1. Reemplazar el bloque CONFIG ====
const newConfig = `const CONFIG = {
  API_URL: '${API}',                         // Tu backend desplegado
  WHATSAPP_NUMBER: '51904894397',
  EMAIL: 'siguientepaso2004@gmail.com',
  LOAD_PRODUCTS_FROM_API: true,              // true = lee de Google Sheets vía backend
  FORMSUBMIT_FALLBACK: 'https://formsubmit.co/ajax/siguientepaso2004@gmail.com'  // Fallback si backend cae
};`;

html = html.replace(
  /const CONFIG = \{[\s\S]*?^\};/m,
  newConfig
);

// ==== 2. Reemplazar envío de cotización por correo ====
const quoteEmailOld = /document\.getElementById\('btnEmailQuote'\)\.addEventListener\('click', async \(\) => \{[\s\S]*?^\}\);/m;

const quoteEmailNew = `document.getElementById('btnEmailQuote').addEventListener('click', async () => {
  const data = validateQuote();
  if (!data) return;
  const btn = document.getElementById('btnEmailQuote');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

  try {
    const deliveryForAPI = {
      type: data.delivery.type === 'Recojo en tienda' ? 'pickup' : 'shalom',
      sede: data.delivery.sede,
      district: data.delivery.district,
      address: data.delivery.address,
      phone: data.delivery.phone,
      reference: data.delivery.reference
    };

    const response = await fetch(CONFIG.API_URL + '/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: data.customer,
        items: data.items.map(i => ({ id: i.id, qty: i.qty })),
        delivery: deliveryForAPI
      })
    });

    const result = await response.json();

    if (response.status === 409 && result.errors) {
      // Stock insuficiente: mostrar productos problemáticos
      const errMsg = result.errors.map(e => e.nombre ? \`\${e.nombre}: pediste \${e.requested}, hay \${e.available}\` : \`\${e.id}: \${e.error}\`).join('. ');
      showNotification('Stock insuficiente: ' + errMsg, 'error');
      return;
    }

    if (!response.ok) throw new Error(result.error || 'Error del servidor');

    showNotification(\`¡Cotización #\${result.quoteId} enviada! Revisa tu correo.\`);
    cart = []; renderCart(); updateSummary();
    document.getElementById('qName').value = '';
    document.getElementById('qPhone').value = '';
    document.getElementById('qEmail').value = '';
  } catch (err) {
    console.error(err);
    showNotification('Error al enviar. Intenta por WhatsApp o más tarde.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
});`;

html = html.replace(quoteEmailOld, quoteEmailNew);

// ==== 3. Reemplazar envío de contacto ====
const contactOld = /contactForm\.addEventListener\('submit', async \(e\) => \{[\s\S]*?^\}\);/m;

const contactNew = `contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = getContactData();
  if (!d.nombre || !d.telefono || !d.correo || !d.mensaje) {
    showNotification('Completa los campos obligatorios', 'error');
    return;
  }

  const submitBtn = contactForm.querySelector('button[type="submit"]');
  const original = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

  try {
    const response = await fetch(CONFIG.API_URL + '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d)
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Error del servidor');

    showNotification('¡Mensaje enviado! Revisa tu correo.');
    contactForm.reset();
  } catch (err) {
    console.error(err);
    showNotification('Error al enviar. Intenta por WhatsApp.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = original;
  }
});`;

html = html.replace(contactOld, contactNew);

// ==== 4. Agregar carga dinámica de productos ====
// Después del array PRODUCTS, inyectar función de carga
const loaderFn = `
/* ==========================================================
   CARGA DINÁMICA DE PRODUCTOS desde el backend
   ========================================================== */
async function loadProductsFromAPI() {
  if (!CONFIG.LOAD_PRODUCTS_FROM_API) return false;
  try {
    const res = await fetch(CONFIG.API_URL + '/api/products');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    // Mapear respuesta del backend al formato que espera el frontend
    const mapped = data.products.map(p => ({
      id: p.id,
      name: p.nombre,
      desc: p.descripcion || '',
      cat: categoryMap(p.categoria),
      price: p.precio,
      stock: p.stock,
      sku: p.sku || p.id,
      link: p.imagen || '#',
      svg: inferSvg(p.nombre, p.categoria),
      badge: p.destacado ? 'Destacado' : (p.marca || p.categoria)
    }));

    // Vaciar y repoblar el array global
    PRODUCTS.length = 0;
    PRODUCTS.push(...mapped);
    return true;
  } catch (err) {
    console.warn('No se pudo cargar productos desde API, usando hardcoded:', err);
    return false;
  }
}

function categoryMap(apiCat) {
  const c = String(apiCat || '').toLowerCase();
  if (c.includes('amp')) return 'amplificador';
  if (c.includes('módulo') || c.includes('modulo')) return 'modulo';
  if (c.includes('informática') || c.includes('informatica')) return 'informatica';
  if (c.includes('ilumina') || c.includes('luminaria')) return 'iluminacion';
  return 'modulo';
}

function inferSvg(name, cat) {
  const n = (name || '').toLowerCase();
  if (n.includes('ram') || n.includes('memoria')) return 'ram';
  if (n.includes('hub usb')) return 'hub';
  if (n.includes('mouse')) return 'mouse';
  if (n.includes('impresora')) return 'printer';
  if (n.includes('soporte')) return 'stand';
  if (n.includes('sensor')) return 'sensor';
  if (n.includes('chip')) return 'chip';
  if (n.includes('elevador')) return 'elevador';
  if (n.includes('deco')) return 'deco-display';
  if (n.includes('300w') || n.includes('220w') || n.includes('160w') || n.includes('500w')) return 'amp-fan';
  if (n.includes('perilla') && n.includes('1')) return 'amp-small';
  return 'amp-knobs';
}

// Cargar al inicio (antes del primer render)
loadProductsFromAPI().then(loaded => {
  if (loaded) {
    renderProducts();
    // Repoblar dropdowns
    const qSel = document.getElementById('qProduct');
    const cSel = document.getElementById('cProduct');
    qSel.innerHTML = '';
    while (cSel.children.length > 1) cSel.removeChild(cSel.lastChild);
    PRODUCTS.forEach(p => {
      if (p.stock > 0) {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = \`\${p.name} — S/ \${p.price} (Stock: \${p.stock})\`;
        qSel.appendChild(o);
      }
      const oc = document.createElement('option');
      oc.value = p.name; oc.textContent = p.name;
      cSel.appendChild(oc);
    });
    document.getElementById('statProductCount').textContent = PRODUCTS.length + '+';
  }
});
`;

// Insertar el loader al final del script, antes del </script> final
html = html.replace(
  /document\.getElementById\('year'\)\.textContent = new Date\(\)\.getFullYear\(\);/,
  `document.getElementById('year').textContent = new Date().getFullYear();\n${loaderFn}`
);

// ==== Guardar ====
fs.writeFileSync(OUTPUT, html, 'utf8');
console.log(`✅ Migración completa: ${OUTPUT}`);
console.log(`   API endpoint: ${API}`);
console.log(`   Tamaño: ${(html.length / 1024).toFixed(1)} KB`);
console.log('');
console.log('Próximos pasos:');
console.log('  1. Sube ' + OUTPUT + ' a Vercel/Netlify');
console.log('  2. Despliega el backend en Render (ver render.yaml)');
console.log('  3. Configura CORS_ORIGIN en el backend con el dominio del frontend');
console.log('  4. Verifica en consola del navegador que no hay errores de red');
