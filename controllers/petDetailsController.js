const PetDetailsSetting = require('../models/petDetailsSetting');

/**
 * Helper function: fetch or create the single PetDetailsSetting doc.
 */
async function getPetDetailsDoc() {
  let doc = await PetDetailsSetting.findOne();
  if (!doc) {
    doc = new PetDetailsSetting(); // create a new empty doc
    await doc.save();
  }
  return doc;
}

// ================== SPECIES ================== //
exports.addSpecies = async (req, res) => {
  try {
    const { species } = req.body;
    if (!species) {
      return res.status(400).json({ success: false, message: "No species provided" });
    }
    const petDetails = await getPetDetailsDoc();
    // Prevent duplicates
    if (petDetails.species.includes(species)) {
      return res.json({ success: false, message: "Species already exists" });
    }
    petDetails.species.push(species);
    // Also initialize an empty array for that species in speciesBreeds
    petDetails.speciesBreeds[species] = petDetails.speciesBreeds[species] || [];
    await petDetails.save();
    return res.json({ success: true });
  } catch (error) {
    console.error("Error adding species:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteSpecies = async (req, res) => {
  try {
    const { species } = req.body;
    if (!species) {
      return res.status(400).json({ success: false, message: "No species provided" });
    }
    const petDetails = await getPetDetailsDoc();
    petDetails.species = petDetails.species.filter(sp => sp !== species);
    delete petDetails.speciesBreeds[species];
    await petDetails.save();
    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting species:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================== BREED ================== //
exports.addBreed = async (req, res) => {
  try {
    const { species, breed } = req.body;
    if (!species || !breed) {
      return res.status(400).json({ success: false, message: "Species and breed are required" });
    }
    const petDetails = await getPetDetailsDoc();
    if (!petDetails.species.includes(species)) {
      return res.status(400).json({ success: false, message: "Species does not exist" });
    }
    petDetails.speciesBreeds[species] = petDetails.speciesBreeds[species] || [];
    if (!petDetails.speciesBreeds[species].includes(breed)) {
      petDetails.speciesBreeds[species].push(breed);
    }
    await petDetails.save();
    return res.json({ success: true });
  } catch (error) {
    console.error("Error adding breed:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================== DISEASE ================== //
exports.addDisease = async (req, res) => {
  try {
    const { disease } = req.body;
    if (!disease) {
      return res.status(400).json({ success: false, message: "No disease provided" });
    }
    const petDetails = await getPetDetailsDoc();
    if (!petDetails.diseases.includes(disease)) {
      petDetails.diseases.push(disease);
      await petDetails.save();
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Error adding disease:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteDisease = async (req, res) => {
  try {
    const { disease } = req.body;
    if (!disease) {
      return res.status(400).json({ success: false, message: "No disease provided" });
    }
    const petDetails = await getPetDetailsDoc();
    petDetails.diseases = petDetails.diseases.filter(ds => ds !== disease);
    await petDetails.save();
    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting disease:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================== SERVICE ================== //
exports.addService = async (req, res) => {
  try {
    const { service } = req.body;
    if (!service) {
      return res.status(400).json({ success: false, message: "No service provided" });
    }
    const petDetails = await getPetDetailsDoc();
    if (!petDetails.services.includes(service)) {
      petDetails.services.push(service);
      await petDetails.save();
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Error adding service:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteService = async (req, res) => {
  try {
    const { service } = req.body;
    if (!service) {
      return res.status(400).json({ success: false, message: "No service provided" });
    }
    const petDetails = await getPetDetailsDoc();
    petDetails.services = petDetails.services.filter(svc => svc !== service);
    await petDetails.save();
    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting service:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================== UPDATE BREEDS ================== //
exports.updateBreeds = async (req, res) => {
  try {
    const { species, breeds } = req.body;
    if (!species || !breeds) {
      return res.status(400).json({ success: false, message: "Species and breeds are required" });
    }
    let breedArray;
    try {
      breedArray = JSON.parse(breeds);
    } catch (err) {
      return res.status(400).json({ success: false, message: "Breeds data is invalid" });
    }
    const petDetails = await getPetDetailsDoc();
    // Update the breeds for the specified species
    petDetails.speciesBreeds[species] = breedArray;
    // IMPORTANT: Mark the speciesBreeds field as modified so that Mongoose will save the changes.
    petDetails.markModified('speciesBreeds');
    
    // Ensure the species is included in the species array.
    if (!petDetails.species.includes(species)) {
      petDetails.species.push(species);
    }
    await petDetails.save();
    console.log("Updated petDetails:", petDetails);
    return res.json({ success: true });
  } catch (error) {
    console.error("Error updating breeds:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};