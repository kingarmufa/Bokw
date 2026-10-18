'use strict';
// Uses the existing Mongoose connection; no memory-only login state or second pool.
module.exports = session => class MongoSessionStore extends session.Store {
  constructor({ connection }) { super(); this.connection = connection; }
  collection() { return this.connection.db.collection('web_sessions'); }
  expiry(value) { return new Date(value.cookie && value.cookie.expires || Date.now() + 86400000); }
  get(sid, callback) {
    this.collection().findOne({ _id: sid, expires: { $gt: new Date() } })
      .then(doc => callback(null, doc ? JSON.parse(doc.value) : null)).catch(callback);
  }
  set(sid, value, callback = () => {}) {
    this.collection().updateOne({ _id: sid }, { $set: { value: JSON.stringify(value), expires: this.expiry(value) } }, { upsert: true })
      .then(() => callback(null)).catch(callback);
  }
  touch(sid, value, callback = () => {}) {
    this.collection().updateOne({ _id: sid }, { $set: { expires: this.expiry(value) } })
      .then(() => callback(null)).catch(callback);
  }
  destroy(sid, callback = () => {}) {
    this.collection().deleteOne({ _id: sid }).then(() => callback(null)).catch(callback);
  }
};
