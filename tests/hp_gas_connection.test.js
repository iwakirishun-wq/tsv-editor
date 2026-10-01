const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, '../gas/HpCheck.gs'), 'utf8');
let configured = null;
let requested;
let payload = {schema: 'hp_price_knowledge/1', events: {test: {label: 'Synthetic', items: []}}};
const sandbox = {
  PropertiesService: {getScriptProperties: () => ({getProperty: () => configured})},
  DriveApp: {getFileById: id => {
    requested = id;
    return {isTrashed: () => false, getBlob: () => ({getDataAsString: () => JSON.stringify(payload)})};
  }}
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
assert.strictEqual(sandbox.listHpEvents()[0].key, 'test');
assert.strictEqual(requested, '1kJ-2JnSVOH56wBc_6-nt8Midqmx07ACg');
configured = 'explicit-override';
assert.strictEqual(sandbox.getHpKnowledge('test').label, 'Synthetic');
assert.strictEqual(requested, configured);
payload = {schema: 'bad'};
assert.ok(sandbox.listHpEvents().error);
console.log('GAS connection: default ID, override, invalid schema passed (mock Drive)');
