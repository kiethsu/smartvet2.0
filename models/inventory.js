// models/inventory.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const InventorySchema = new Schema({
  name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: [
      "pet grooming",
      "pet accessories",
      "pet essentials",
      "pet medication",
      "pet vaccination",
      "heartworm preventive",
      "anti-thick and flea preventive",
      "injectable meds",
      "clinic needs",
      "surgery",
      "cbc",
      "blood chemistry",
      "gas anesthesia",
      "cbc/blood chemistry",
      "urinalysis",
      "ultrasounds",
      "blood collection",
      "syringe",
      "needle",
      "test kits",
      "petfood",
      "dewormer"
    ]
  },
  price: {
    type: Number,
    required: true  // Price is in Philippine Peso
  },
  // Instead of a single expirationDate, use an array (optional)
  expirationDates: [{
    type: Date
  }],
  // Total stock quantity for this product batch
  quantity: {
    type: Number,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model("Inventory", InventorySchema);
