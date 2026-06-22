import '@testing-library/jest-dom';

// jsdom does not implement URL.createObjectURL / revokeObjectURL, which
// components like BouquetImageEditor call on file pick. Stub them so those
// component tests can mount. (Real browsers provide these.)
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock';
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
}
