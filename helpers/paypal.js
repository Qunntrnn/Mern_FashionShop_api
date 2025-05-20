const paypal = require("paypal-rest-sdk");

paypal.configure({
  mode: "sandbox",
  client_id: "AUCbRZuyRmfQe4-vGQzzGiMP5xH2xkn74Qvm1dKzLAWfWyQsmki2tN1VSGK3EmYi2BGKtu9Jd02F2lP8",
  client_secret: "EB-6QXJnrWYHwpmuf-rB9ypefZfLgXD13y9rWfSblZmdSAYHb8-51h5qKcDntPrwVzSU0oyBwq0riuoH"
});

// Sandbox buyer account credentials
const sandboxBuyer = {
  email: "sb-47bfpf29419931@personal.example.com",
  password: "your-buyer-password"
};

module.exports = paypal;
