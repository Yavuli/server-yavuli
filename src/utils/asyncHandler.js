// Wrapper to catch async errors in routes
// This prevents unhandled promise rejections and passes errors to global error handler
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
