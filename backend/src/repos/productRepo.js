// Product repository — Phase 6: backed by Postgres product_config via productConfigRepo.
//
// This file is now a thin delegation layer. All image-cache methods
// (setImage / getImage / getImagesBatch) delegate straight to
// productConfigRepo which reads and writes product_config in PG.
//
// Keeping this shim means the callers (productImages.js route) don't need
// to be updated — they import productRepo and get the right backend for free.

import * as productConfigRepo from './productConfigRepo.js';

export const setImage       = productConfigRepo.setImage;
export const getImage       = productConfigRepo.getImage;
export const getImagesBatch = productConfigRepo.getImagesBatch;
