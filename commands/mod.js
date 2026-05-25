'use strict';
const RolesModel = require('../db/models/Roles');
module.exports = {
  name:'mod', aliases:['unmod','dev','undev'], permissions:'mod', cooldown:false,
  execute(ctx) {
    const { userId, user, args, say, CHANNEL, cmd } = ctx;
    const target  = (args[0]||'').replace('@','').toLowerCase();
    if (!target) { say(`❌ Usage: !${cmd} <username>`); return { ok:false }; }
    const role    = cmd.includes('dev')?'dev':'mod';
    const revoking = cmd.startsWith('un');
    if (!revoking && role==='dev' && userId!==CHANNEL) { say(`❌ Only streamer can grant dev`); return { ok:false }; }
    if (revoking) { RolesModel.revoke(target, role); say(`✅ @${target} ${role} removed`); }
    else          { RolesModel.grant(target, role, userId); say(`✅ @${target} is now a ${role}!`); }
    return { ok:true };
  },
};
