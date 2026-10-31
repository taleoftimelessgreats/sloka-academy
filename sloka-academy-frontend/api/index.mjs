// Vercel Function: the Sloka Academy API (../sloka-academy-backend) under /api on the website's own
// domain. vercel.json sends every /api/* request here and the backend's Express app does the routing.
// waitUntil keeps emails and Google Sheets syncs running after the response has been sent.
import { waitUntil } from "@vercel/functions";
import serverless from "../../sloka-academy-backend/src/serverless.js";

export default serverless.createHandler({ background: waitUntil });
