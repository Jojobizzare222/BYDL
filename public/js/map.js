// Kamwa — cartes intégrées (points relais, suivi du livreur) : Leaflet 1.9.4 (licence BSD, hébergé sur Kamwa,
// public/vendor/leaflet) + fonds de carte OpenStreetMap (libres, sans clé ni compte ; attribution obligatoire).
// Chargé seulement quand une carte s'affiche (économe en données mobiles). Utilisé par la boutique et Kamwa Pro.
(() => {
  const CITIES = { 'Pointe-Noire': [-4.7761, 11.8635], Brazzaville: [-4.2634, 15.2429], Dolisie: [-4.199, 12.6666] };
  let loading = null;
  function load() {
    if (window.L) return Promise.resolve(window.L);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.appendChild(css);
        const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js'; s.async = true;
        s.onload = () => resolve(window.L); s.onerror = () => { loading = null; reject(new Error('Carte indisponible (connexion ?)')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }
  // Repères aux couleurs Kamwa (pas d'image à télécharger)
  const pin = (L, kind = 'relay', label = '') => L.divIcon({
    className: `kmap-pin kmap-${kind}`, iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36],
    html: `<span>${label}</span>`,
  });
  async function create(el, { center, zoom = 13, city } = {}) {
    // « Économie de données » (réglage du client) : la carte ne se charge que s'il la demande
    if (document.documentElement.getAttribute('data-saver') === 'on' && !el.dataset.allowed) {
      await new Promise((resolve) => {
        el.classList.add('kmap-lazy');
        el.innerHTML = '<button type="button" class="btn ghost small">Afficher la carte</button><small>Économie de données activée</small>';
        el.querySelector('button').addEventListener('click', () => { el.dataset.allowed = '1'; el.classList.remove('kmap-lazy'); el.innerHTML = ''; resolve(); }, { once: true });
      });
    }
    const L = await load();
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    map.setView(center || CITIES[city] || CITIES['Pointe-Noire'], zoom);
    el.addEventListener('focusin', () => map.scrollWheelZoom.enable());
    setTimeout(() => map.invalidateSize(), 60);
    return { L, map };
  }
  const hasPos = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  const distanceKm = (a, b) => {
    const R = 6371, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  // Itinéraire dans l'application Google Maps du téléphone (lien, aucune clé nécessaire)
  const directions = (p) => `https://www.google.com/maps/dir/?api=1&destination=${Number(p.lat)},${Number(p.lng)}`;
  const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Position indisponible sur cet appareil'));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? "Autorisez l'accès à votre position dans le navigateur" : 'Position introuvable, réessayez')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
  window.kamwaMap = { load, create, pin, hasPos, distanceKm, directions, locate, CITIES };
})();
