const Query = require("./Query");

const q = new Query({host: 'localhost', port: 9630});

q.fullStat()
  .then(success => {

    console.log(success);

    return q.basicStat()

  })

  .then(success => {

    console.log(success);

    q.close();

  })
