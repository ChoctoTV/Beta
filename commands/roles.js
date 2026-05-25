'use strict';
const Duty       = require('../economy/duty');
const RolesModel = require('../db/models/Roles');
module.exports = {
  name:'roles', permissions:'mod', cooldown:false,
  execute(ctx) {
    const { say } = ctx;
    const { mods, devs } = Duty.onDutyList();
    say(`🛡️ Mods: ${RolesModel.list('mod').join(', ')||'none'} | On duty: ${mods.join(', ')||'none'}`);
    say(`🔧 Devs: ${RolesModel.list('dev').join(', ')||'none'} | On duty: ${devs.join(', ')||'none'}`);
    return { ok:true };
  },
};
