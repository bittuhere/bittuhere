// Map Editor Base64 Assets
// This file contains embedded GLB models as base64 strings
// Generated for offline/embedded use

window.CITY_URI = 'data:application/octet-stream;base64,GLB_CITY_MODEL_BASE64_HERE';
window.CAR_URI = 'data:application/octet-stream;base64,GLB_CAR_MODEL_BASE64_HERE';

// Asset metadata
window.ASSETS = {
  city: {
    name: 'City Building',
    type: 'environment',
    polygons: 50000,
    size: '2.5 MB',
    uri: CITY_URI
  },
  car: {
    name: 'Low Poly Car',
    type: 'vehicle',
    polygons: 1200,
    size: '150 KB',
    uri: CAR_URI
  }
};

// Helper to encode file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper to decode base64 to blob
function base64ToBlob(base64, type = 'application/octet-stream') {
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type });
}