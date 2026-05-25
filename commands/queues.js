'use strict';
// !queues — revive the queue bar for another 30 seconds
module.exports = {
  name:'queues', permissions:'viewer', cooldown:10,
  execute({ broadcast }) {
    broadcast({ type:'show_queues' });
    return { ok:true };
  },
};
