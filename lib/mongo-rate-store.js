'use strict';
// Shared fixed-window counters: cold starts must not reset login/API limits.
module.exports = class MongoRateStore {
  constructor(connection, prefix) { this.connection = connection; this.prefix = prefix; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  collection() { return this.connection.db.collection('web_rate_limits'); }
  id(key) { return this.prefix + ':' + key; }
  async increment(key) {
    const now = new Date();
    const expires = new Date(Date.now() + this.windowMs);
    const expired = { $lte: [{ $ifNull: ['$expires', new Date(0)] }, now] };
    const doc = await this.collection().findOneAndUpdate({ _id: this.id(key) }, [{ $set: {
      hits: { $cond: [expired, 1, { $add: ['$hits', 1] }] },
      expires: { $cond: [expired, expires, '$expires'] }
    } }], { upsert: true, returnDocument: 'after', includeResultMetadata: false });
    return { totalHits: doc.hits, resetTime: doc.expires };
  }
  async decrement(key) { await this.collection().updateOne({ _id: this.id(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } }); }
  async resetKey(key) { await this.collection().deleteOne({ _id: this.id(key) }); }
};
