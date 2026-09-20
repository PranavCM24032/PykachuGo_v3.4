const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'js', 'login-helpers.js');

function loadLoginHelpers() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const storage = {
    values: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
    },
    setItem(key, value) {
      this.values[key] = String(value);
    },
    removeItem(key) {
      delete this.values[key];
    }
  };

  const context = {
    localStorage: storage,
    console,
    document: {
      addEventListener() {},
      querySelectorAll() { return []; }
    },
    window: {}
  };

  vm.runInNewContext(source, context);
  return { ...context, storage };
}

test('saveLoginState stores name and key for return visits', () => {
  const { storage, saveLoginState, readStoredLoginState } = loadLoginHelpers();
  const payload = {
    name: 'ASH',
    securityKey: 'Pikachu123',
    missionLevel: 'L1_GRASS',
    language: 'PYTHON'
  };

  saveLoginState(payload, storage);

  assert.equal(storage.getItem('pykachuLogin'), JSON.stringify(payload));
  assert.equal(JSON.stringify(readStoredLoginState(storage)), JSON.stringify(payload));
});

test('readStoredLoginState falls back to legacy teamInfo data', () => {
  const { storage, readStoredLoginState } = loadLoginHelpers();
  const expected = {
    name: 'TEAM RED',
    securityKey: 'SECRET-KEY',
    missionLevel: 'L2_CHARIZARD',
    language: 'CPP'
  };

  storage.setItem('pykachuTeam', JSON.stringify(expected));

  assert.equal(JSON.stringify(readStoredLoginState(storage)), JSON.stringify(expected));
});
