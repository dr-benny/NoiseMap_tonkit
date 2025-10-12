import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.text({ type: "*/*" }));

// CORS middleware
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
    } else {
        next();
    }
});

app.post("/wfs-proxy", async (req, res) => {
    try {
        const response = await fetch(
            "http://localhost:8080/geoserver/it.geosolutions/wfs",
            {
                method: "POST",
                headers: { "Content-Type": "text/xml" },
                body: req.body,
            },
        );
        const text = await response.text();
        res.setHeader("Content-Type", "application/xml");
        res.send(text);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.listen(3000, () => {
    console.log("Proxy listening on port 3000");
});
