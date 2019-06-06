const Query = require("./Query");
const q = new Query({host: '', port: 25565});

q.fullStat()
  .then(success => {

    console.log(success);

    return q.basicStat()

  })

  .then(success => {

    console.log(success);

  })
