const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ServiceCategorySchema = new Schema({
  name: { type: String, required: true, unique: true }
}, { timestamps: true });

module.exports = mongoose.model('ServiceCategory', ServiceCategorySchema);
