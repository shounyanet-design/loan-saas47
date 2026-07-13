/**
 * Requires every model file so that mongoose.models is fully populated before
 * migrations iterate over registered models.
 */
const fs = require('fs');
const path = require('path');

function loadAllModels() {
  const modelsDir = path.join(__dirname, '../models');
  for (const file of fs.readdirSync(modelsDir)) {
    if (file.endsWith('.js')) require(path.join(modelsDir, file));
  }
  // Models that live inside feature modules (src/modules/<m>/models/*.js).
  const modulesDir = path.join(__dirname, '../modules');
  if (fs.existsSync(modulesDir)) {
    for (const mod of fs.readdirSync(modulesDir)) {
      const modModels = path.join(modulesDir, mod, 'models');
      if (fs.existsSync(modModels)) {
        for (const file of fs.readdirSync(modModels)) {
          if (file.endsWith('.js')) require(path.join(modModels, file));
        }
      }
    }
  }
}

module.exports = loadAllModels;
