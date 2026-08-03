# NuPay BTM Implementation Matrix

## DebiCheck Mandate Initiation
- **Specification:** DebiCheck Mandate Initiation Specification_Version3.7
- **Endpoint/path:** `/wsDebiCheck/mandate_initiation`
- **HTTP Method:** POST
- **Authentication:** Base64(username:password) in JSON `auth` field
- **Request Root Structure:** JSON payload with `auth` and `cardAcceptor` 
- **Fields:**
  - `frequency`: string, required, enum (e.g. `M`, `W`)
  - `collectionDay`: int, required
  - `clientReference`: string, max length 20
  - `contractReference`: string, max length 20
  - `debtorName`: string, required
  - `debtorIdType`: string, required
  - `debtorAccountNumber`: string, required
  - `debtorAccountType`: int, required
  - `debtorBankId`: string, required
  - `firstCollectionAmount`: decimal, required
  - `startDate`: string YYYYMMDD, required
- **Response Fields:**
  - `referenceNumbers.mandateRequestTranId`
  - `ResultCode`
  - `Status`
- **ResultCode Meanings:** (Extracted values here)

## DebiCheck Mandate Maintenance
- **Specification:** DebiCheck Mandate Maintenance Specification_Version 3
- **Endpoint/path:** `/wsDebiCheck/mandate_maintenance`
- **HTTP Method:** POST
- **Authentication:** Base64(username:password) in JSON `auth` field
- **Fields:**
  - *Extracted fields pending detail scan*

## DebiCheck Instalment Add
- **Specification:** DebiCheck Instalment Maintenance_Version1.5
- **Endpoint/path:** `/wsDebiCheck/add_instalment`
- **HTTP Method:** POST
- **Authentication:** Base64(username:password) in JSON `auth` field
- **Fields:**
  - *Extracted fields pending detail scan*

## DebiCheck Instalment Maintenance
- **Specification:** DebiCheck Instalment Maintenance_Version1.5
- **Endpoint/path:** `/wsDebiCheck/instalment_maintenance`
- **HTTP Method:** POST

## DebiCheck Settlement Report
- **Specification:** DebiCheck Settlement Report_Version1.4
- **Endpoint/path:** `/wsDebiCheck/report/settlement_report`
- **HTTP Method:** POST

## DebiCheck TT1 Endpoint Registration
- **Specification:** DebiCheck TT1 Mandate Response Specification_Version1.1
- **Endpoint/path:** `/wsDebiCheck/register_endpoint`
- **HTTP Method:** POST
- **Fields:** `endpointUrl`, `registrationStatus` (Register/Deregister)

## Needs Confirmation
- NEEDS_CONFIRMATION: Exact list of valid enum values for `ResultCode` matrices per endpoint.
