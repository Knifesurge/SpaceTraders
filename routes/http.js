export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const sendJson = (res, payload, status = 200) => {
  res.status(status).type("json").send(JSON.stringify(payload, null, 2));
};

const wantsJsonResponse = (req) => {
  const jsonFlag = String(req?.query?.json || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(jsonFlag);
};

export const sendSuccess = (req, res, options = {}) => {
  const { data, view, locals = {}, status = 200 } = options;

  if (view && !wantsJsonResponse(req)) {
    const viewLocals = {
      ...locals,
    };

    if (data !== undefined) {
      viewLocals.data = data;
    }

    return res.status(status).render(view, {
      ...viewLocals,
    });
  }

  if (data !== undefined) {
    return sendJson(res, data, status);
  }

  return sendJson(res, locals, status);
};

export const getErrorStatus = (error) => {
  if (error?.response?.status) return error.response.status;
  if (error?.status) return error.status;
  return 500;
};

export const getErrorPayload = (error) => {
  if (error?.response?.data) return error.response.data;
  return {
    error: {
      message: error?.message || "Unexpected error",
    },
  };
};

export const apiErrorHandler = (error, req, res, next) => {
  const status = getErrorStatus(error);
  const payload = getErrorPayload(error);

  if (req.path.endsWith("/view")) {
    return res.status(status).render("error", {
      title: "Request Error",
      status,
      payload,
    });
  }

  return sendJson(res, payload, status);
};
