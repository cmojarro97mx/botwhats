const fetch = require("node-fetch");

function Zarinpal(merchantId, sandbox = false) {
  if (typeof merchantId !== "string") {
    throw new Error("The provided merchantId is invalid.");
  }
  if (merchantId.length !== 36) {
    throw new Error("The provided merchantId is invalid.");
  }

  const webGateSandboxUrl = "https://sandbox.zarinpal.com/pg/rest/WebGate/";
  const webGateHttpsUrl = "https://www.zarinpal.com/pg/rest/WebGate/";

  const startPaySandboxUrl = "https://sandbox.zarinpal.com/pg/StartPay/";
  const startPayHttpsUrl = "https://www.zarinpal.com/pg/StartPay/";

  this.merchantId = merchantId;
  this.webGateUrl = sandbox === true ? webGateSandboxUrl : webGateHttpsUrl;
  this.startPayUrl = sandbox === true ? startPaySandboxUrl : startPayHttpsUrl;
}

Zarinpal.prototype.requestPayment = async function ({
  amount,
  callbackUrl,
  description,
  email,
  phoneNumber,
}) {
  let gateway = this;

  let json = {
    MerchantID: gateway.merchantId,
    Amount: amount,
    CallbackURL: callbackUrl,
    Description: description,
    Email: email,
    Mobile: phoneNumber,
  };

  const response = await fetch(`${gateway.webGateUrl}/PaymentRequest.json`, {
    method: "POST",
    headers: {
      "cache-control": "no-cache",
      "content-type": "application/json",
    },
    body: JSON.stringify(json),
  });

  const body = await response.json();

  if (!(body.Status == 100 && body.Authority.length === 36)) {
    throw new Error("An error occurred during the payment process.");
  }

  return body.Authority;
};

Zarinpal.prototype.verifyPayment = async function ({ amount, authority }) {
  let gateway = this;

  let json = {
    MerchantID: gateway.merchantId,
    Amount: amount,
    Authority: authority,
  };

  const response = await fetch(
    `${gateway.webGateUrl}/PaymentVerification.json`,
    {
      method: "POST",
      headers: {
        "cache-control": "no-cache",
        "content-type": "application/json",
      },
      body: JSON.stringify(json),
    }
  );

  const body = await response.json();

  if (body.Status !== 100) {
    throw new Error("Transition failed.");
  }

  return body.RefID;
};

function setting(merchantId, sandbox) {
  return new Zarinpal(merchantId, sandbox);
}

module.exports = {
  Zarinpal,
  setting,
};
