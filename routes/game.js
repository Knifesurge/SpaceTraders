import express from 'express';
import config from '../data/config.js';
// Import API

const router = express.Router();

router.get(`${config.BASE_URL}`)
	.then(response => console.log(JSON.stringify(response.data)))
	.catch(error => console.error(error));

export default router;
