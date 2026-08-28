const { EconomyController } = require('./BackendUtils');
const Console = require("./ConsoleUtils");

module.exports = function(app) {
    Console.log("System", "🛠️ Injecting Ultimate Shop Fix...");

    app.all('/economy/purchase/:item', EconomyController.purchase);
    app.all('/economy/purchasegasha/:itemId/:count', EconomyController.purchaseGasha);
    app.all('/economy/purchaseluckyspin', EconomyController.purchaseLuckySpin);
    app.all('/economy/purchasedrop/:itemId/:count', EconomyController.purchaseDrop);

    app.all('/economy/purchaseluckyspinwheel', EconomyController.purchaseLuckySpinWheel);

    app.use((req, res, next) => {
        Console.error("SHOP 404", `Client tried to hit a missing route: [${req.method}] ${req.originalUrl}`);
        res.status(404).json({ error: "ROUTE_NOT_FOUND", path: req.originalUrl });
    });
};
