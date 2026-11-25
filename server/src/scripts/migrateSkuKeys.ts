import mongoose from 'mongoose';
import { connectToMongoAtlas, disconnectFromMongoAtlas } from '../database/connection';
import { ProductModel } from '../modules/products/product.model';

type CatalogProduct = {
  _id: mongoose.Types.ObjectId;
  sku: string;
  variants?: Array<{ sku?: string }>;
  skuKeys?: string[];
};

async function main() {
  const apply = process.argv.includes('--apply');
  mongoose.set('autoIndex', false);
  const connected = await connectToMongoAtlas();
  if (!connected) {
    process.exitCode = 1;
    return;
  }

  try {
    const products = (await ProductModel.find()
      .select('_id sku variants.sku skuKeys')
      .lean()) as CatalogProduct[];
    const skuOwners = new Map<string, string>();
    const collisions: Array<{ sku: string; firstProductId: string; secondProductId: string }> = [];
    const updates: Array<{ productId: mongoose.Types.ObjectId; skuKeys: string[] }> = [];

    for (const product of products) {
      const rawSkuKeys = [product.sku, ...(product.variants || []).map((variant) => variant.sku || '')]
        .map((sku) => sku.trim().toUpperCase())
        .filter(Boolean);
      const skuKeys = Array.from(new Set(rawSkuKeys));
      const productId = String(product._id);
      const seenWithinProduct = new Set<string>();
      for (const sku of rawSkuKeys) {
        if (seenWithinProduct.has(sku)) {
          collisions.push({ sku, firstProductId: productId, secondProductId: productId });
          continue;
        }
        seenWithinProduct.add(sku);
        const owner = skuOwners.get(sku);
        if (owner && owner !== productId) {
          collisions.push({ sku, firstProductId: owner, secondProductId: productId });
        } else {
          skuOwners.set(sku, productId);
        }
      }
      if (JSON.stringify(product.skuKeys || []) !== JSON.stringify(skuKeys)) {
        updates.push({ productId: product._id, skuKeys });
      }
    }

    if (collisions.length > 0) {
      console.error('SKU collisions must be resolved before the skuKeys index can be created:');
      collisions.forEach((collision) => console.error(JSON.stringify(collision)));
      process.exitCode = 1;
      return;
    }

    console.info(`Products scanned: ${products.length}`);
    console.info(`skuKeys backfills/updates required: ${updates.length}`);
    if (!apply) {
      console.info('Dry run only; no database records or indexes were changed.');
      console.info('Review the result, stop catalog writes, then rerun with --apply to apply the backfill and unique index.');
      return;
    }

    if (updates.length > 0) {
      await ProductModel.bulkWrite(
        updates.map(({ productId, skuKeys }) => ({
          updateOne: { filter: { _id: productId }, update: { $set: { skuKeys } } },
        })),
        { ordered: true },
      );
    }
    await ProductModel.collection.createIndex(
      { skuKeys: 1 },
      { unique: true, sparse: true, name: 'skuKeys_unique' },
    );
    console.info('skuKeys backfill and unique index completed.');
  } finally {
    await disconnectFromMongoAtlas();
  }
}

main().catch((error: unknown) => {
  console.error('skuKeys migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
