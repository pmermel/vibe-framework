import express from "express";
import { router } from "./router.js";

const app = express();
const port = process.env.PORT ?? "8080";

app.use(express.json());
app.use("/", router);

app.listen(Number(port), () => {
  console.log(`vibe-backend listening on port ${port}`);
});
