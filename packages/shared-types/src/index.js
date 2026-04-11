"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatIntent = exports.AdapterType = exports.FieldType = exports.AuthType = exports.OAType = exports.BootstrapSourceType = exports.BootstrapJobStatus = exports.FALLevel = exports.OCLLevel = void 0;
// ============================================================
// OA Compatibility Level (OCL)
// ============================================================
var OCLLevel;
(function (OCLLevel) {
    OCLLevel["OCL0"] = "OCL0";
    OCLLevel["OCL1"] = "OCL1";
    OCLLevel["OCL2"] = "OCL2";
    OCLLevel["OCL3"] = "OCL3";
    OCLLevel["OCL4"] = "OCL4";
    OCLLevel["OCL5"] = "OCL5";
})(OCLLevel || (exports.OCLLevel = OCLLevel = {}));
// ============================================================
// Flow Automation Level (FAL)
// ============================================================
var FALLevel;
(function (FALLevel) {
    FALLevel["F0"] = "F0";
    FALLevel["F1"] = "F1";
    FALLevel["F2"] = "F2";
    FALLevel["F3"] = "F3";
    FALLevel["F4"] = "F4";
})(FALLevel || (exports.FALLevel = FALLevel = {}));
// ============================================================
// Bootstrap Job Status
// ============================================================
var BootstrapJobStatus;
(function (BootstrapJobStatus) {
    BootstrapJobStatus["CREATED"] = "CREATED";
    BootstrapJobStatus["DISCOVERING"] = "DISCOVERING";
    BootstrapJobStatus["PARSING"] = "PARSING";
    BootstrapJobStatus["NORMALIZING"] = "NORMALIZING";
    BootstrapJobStatus["COMPILING"] = "COMPILING";
    BootstrapJobStatus["REPLAYING"] = "REPLAYING";
    BootstrapJobStatus["REVIEW"] = "REVIEW";
    BootstrapJobStatus["PUBLISHED"] = "PUBLISHED";
    BootstrapJobStatus["FAILED"] = "FAILED";
})(BootstrapJobStatus || (exports.BootstrapJobStatus = BootstrapJobStatus = {}));
// ============================================================
// Bootstrap Source Type
// ============================================================
var BootstrapSourceType;
(function (BootstrapSourceType) {
    BootstrapSourceType["OA_URL"] = "oa_url";
    BootstrapSourceType["SOURCE_BUNDLE"] = "source_bundle";
    BootstrapSourceType["OPENAPI"] = "openapi";
    BootstrapSourceType["HAR"] = "har";
    BootstrapSourceType["FILE"] = "file";
})(BootstrapSourceType || (exports.BootstrapSourceType = BootstrapSourceType = {}));
// ============================================================
// OA Type
// ============================================================
var OAType;
(function (OAType) {
    OAType["OPENAPI"] = "openapi";
    OAType["FORM_PAGE"] = "form-page";
    OAType["HYBRID"] = "hybrid";
})(OAType || (exports.OAType = OAType = {}));
// ============================================================
// Auth Type
// ============================================================
var AuthType;
(function (AuthType) {
    AuthType["OAUTH2"] = "oauth2";
    AuthType["BASIC"] = "basic";
    AuthType["APIKEY"] = "apikey";
    AuthType["COOKIE"] = "cookie";
})(AuthType || (exports.AuthType = AuthType = {}));
var FieldType;
(function (FieldType) {
    FieldType["TEXT"] = "text";
    FieldType["NUMBER"] = "number";
    FieldType["DATE"] = "date";
    FieldType["SELECT"] = "select";
    FieldType["RADIO"] = "radio";
    FieldType["CHECKBOX"] = "checkbox";
    FieldType["FILE"] = "file";
    FieldType["TEXTAREA"] = "textarea";
})(FieldType || (exports.FieldType = FieldType = {}));
// ============================================================
// Adapter
// ============================================================
var AdapterType;
(function (AdapterType) {
    AdapterType["API"] = "api";
    AdapterType["RPA"] = "rpa";
    AdapterType["HYBRID"] = "hybrid";
})(AdapterType || (exports.AdapterType = AdapterType = {}));
// ============================================================
// Chat Intent
// ============================================================
var ChatIntent;
(function (ChatIntent) {
    ChatIntent["CREATE_SUBMISSION"] = "create_submission";
    ChatIntent["QUERY_STATUS"] = "query_status";
    ChatIntent["CANCEL_SUBMISSION"] = "cancel_submission";
    ChatIntent["URGE"] = "urge";
    ChatIntent["SUPPLEMENT"] = "supplement";
    ChatIntent["DELEGATE"] = "delegate";
    ChatIntent["SERVICE_REQUEST"] = "service_request";
    ChatIntent["UNKNOWN"] = "unknown";
})(ChatIntent || (exports.ChatIntent = ChatIntent = {}));
//# sourceMappingURL=index.js.map