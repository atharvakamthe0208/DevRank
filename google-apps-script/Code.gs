/**
 * DevRank candidate information form setup.
 *
 * Run setupDevRankCandidateForm() once to create the form and linked response
 * spreadsheet. Google Apps Script's FormApp currently cannot create a file
 * upload question, so add the required PDF upload question manually in the
 * form editor; see README.md.
 */

const DEVRANK_FORM_TITLE = 'DevRank Candidate Information Form';
const DEVRANK_FORM_DESCRIPTION =
  'Submit your contact information and coding profile links for the DevRank project. ' +
  'Your responses will be collected for candidate review.';
const DEVRANK_SPREADSHEET_TITLE = 'DevRank Candidate Responses';
const DEVRANK_FORM_ID_PROPERTY = 'DEVRANK_CANDIDATE_FORM_ID';
const DEVRANK_SPREADSHEET_ID_PROPERTY = 'DEVRANK_CANDIDATE_SPREADSHEET_ID';

/** Creates or safely reuses the DevRank form and its response spreadsheet. */
function setupDevRankCandidateForm() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Another setup run is in progress. Please try again shortly.');
  }

  try {
    const properties = PropertiesService.getScriptProperties();
    const spreadsheet = reopenAndVerifySpreadsheet_(getOrCreateSpreadsheet_(properties).getId());
    const formId = properties.getProperty(DEVRANK_FORM_ID_PROPERTY);
    const form = reopenAndVerifyForm_(formId);

    form.setTitle(DEVRANK_FORM_TITLE);
    form.setDescription(DEVRANK_FORM_DESCRIPTION);
    ensureRequiredTextQuestion_(form, 'Full Name');
    ensureRequiredTextQuestion_(form, 'Gmail Address', true);
    ensureRequiredTextQuestion_(form, 'GitHub Username or Profile URL');
    ensureRequiredTextQuestion_(form, 'LeetCode Username or Profile URL');

    // getDestinationId() throws when a form has no response destination.
    // Setting the destination directly is safe for both new and reused forms
    // and repairs the link if someone changed it since the previous run.
    form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());
    ensureFormAcceptsResponses_(form);

    logVerifiedDetails_(form, spreadsheet);
    logResumeUploadQuestionStatus_(form);
  } finally {
    lock.releaseLock();
  }
}

/** Reopens saved resources and logs their IDs, links, publication state, and response destination. */
function diagnoseDevRankCandidateForm() {
  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty(DEVRANK_FORM_ID_PROPERTY);
  const spreadsheetId = properties.getProperty(DEVRANK_SPREADSHEET_ID_PROPERTY);
  if (!formId || !spreadsheetId) {
    throw new Error('Form or spreadsheet IDs are not saved. Run setupDevRankCandidateForm() first.');
  }

  const form = reopenAndVerifyForm_(formId);
  const spreadsheet = reopenAndVerifySpreadsheet_(spreadsheetId);
  logVerifiedDetails_(form, spreadsheet);

  let destinationId;
  try {
    destinationId = form.getDestinationId();
  } catch (error) {
    destinationId = '';
  }
  console.log('Response destination ID: ' + (destinationId || 'NOT SET'));
  console.log(
    'Response destination check: ' +
    (destinationId === spreadsheet.getId() ? 'MATCHES saved spreadsheet' : 'MISSING OR DOES NOT MATCH; rerun setupDevRankCandidateForm()')
  );

  const supportsPublishing = form.supportsAdvancedResponderPermissions();
  console.log(
    'Form published: ' +
    (supportsPublishing ? String(form.isPublished()) : 'Not exposed for this form type; verify in the form editor')
  );
  console.log('Form accepting responses: ' + String(form.isAcceptingResponses()));
}

/** Backward-compatible link logger; also reports the destination and response state. */
function showDevRankCandidateFormLinks() {
  diagnoseDevRankCandidateForm();
}

function getOrCreateSpreadsheet_(properties) {
  const savedId = properties.getProperty(DEVRANK_SPREADSHEET_ID_PROPERTY);
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (error) {
      throw new Error(
        'The saved response spreadsheet cannot be opened, so setup stopped without creating a duplicate. ' +
        'If it still exists, restore access. If it was deleted, remove the ' +
        DEVRANK_SPREADSHEET_ID_PROPERTY + ' Script Property and run setup again.'
      );
    }
  }

  const spreadsheet = SpreadsheetApp.create(DEVRANK_SPREADSHEET_TITLE);
  // Save immediately so a later partial setup can reuse this spreadsheet.
  properties.setProperty(DEVRANK_SPREADSHEET_ID_PROPERTY, spreadsheet.getId());
  return spreadsheet;
}

function getOrCreateForm_(properties) {
  const savedId = properties.getProperty(DEVRANK_FORM_ID_PROPERTY);
  if (savedId) {
    try {
      return FormApp.openById(savedId);
    } catch (error) {
      throw new Error(
        'The saved form cannot be opened, so setup stopped without creating a duplicate. ' +
        'If it still exists, restore access. If it was deleted, remove the ' +
        DEVRANK_FORM_ID_PROPERTY + ' Script Property and run setup again.'
      );
    }
  }

  const form = FormApp.create(DEVRANK_FORM_TITLE);
  // Save immediately so a later partial setup can reuse this form.
  properties.setProperty(DEVRANK_FORM_ID_PROPERTY, form.getId());
  return form;
}

function reopenAndVerifyForm_(formId) {
  if (!formId) {
    throw new Error('No saved form ID is available. Run setupDevRankCandidateForm() to create the form.');
  }

  let form;
  try {
    form = FormApp.openById(formId);
  } catch (error) {
    throw new Error(
      'Could not reopen saved form ID ' + formId + '. Setup stopped without creating another form. ' +
      'If the form exists, run this script under an account that can access it. If it was deleted, remove only the ' +
      DEVRANK_FORM_ID_PROPERTY + ' Script Property, then rerun setup.'
    );
  }

  const openedId = form.getId();
  if (openedId !== formId) {
    throw new Error('The form reopened with a different ID. Setup stopped to avoid changing the wrong form.');
  }
  return form;
}

function reopenAndVerifySpreadsheet_(spreadsheetId) {
  if (!spreadsheetId) {
    throw new Error('No saved spreadsheet ID is available. Run setupDevRankCandidateForm() to create it.');
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error(
      'Could not reopen saved spreadsheet ID ' + spreadsheetId + '. Setup stopped without creating another spreadsheet. ' +
      'If it exists, restore access. If it was deleted, remove only the ' +
      DEVRANK_SPREADSHEET_ID_PROPERTY + ' Script Property, then rerun setup.'
    );
  }

  if (spreadsheet.getId() !== spreadsheetId) {
    throw new Error('The spreadsheet reopened with a different ID. Setup stopped to avoid changing the wrong file.');
  }
  return spreadsheet;
}

function ensureFormAcceptsResponses_(form) {
  const supportsPublishing = form.supportsAdvancedResponderPermissions();
  try {
    if (supportsPublishing && !form.isPublished()) {
      form.setPublished(true);
    }
    if (!form.isAcceptingResponses()) {
      form.setAcceptingResponses(true);
    }
  } catch (error) {
    throw new Error(
      'The form and spreadsheet were linked, but Apps Script could not make the form available for responses. ' +
      'Open the form edit URL and publish it or enable responses manually. Details: ' + error.message
    );
  }

  if ((supportsPublishing && !form.isPublished()) || !form.isAcceptingResponses()) {
    throw new Error(
      'The form is not published or is not accepting responses. Open its edit URL and enable responses manually.'
    );
  }
}

function ensureRequiredTextQuestion_(form, title, validateEmail) {
  const matches = form.getItems().filter(function (item) {
    return item.getTitle() === title;
  });

  if (matches.length > 1) {
    throw new Error('The form contains duplicate questions titled “' + title + '”. Remove duplicates manually.');
  }

  let question;
  if (matches.length === 1) {
    if (matches[0].getType() !== FormApp.ItemType.TEXT) {
      throw new Error('The existing “' + title + '” item is not a short-answer text question.');
    }
    question = matches[0].asTextItem();
  } else {
    question = form.addTextItem().setTitle(title);
  }

  question.setRequired(true);
  if (validateEmail) {
    const validation = FormApp.createTextValidation()
      .requireTextIsEmail()
      .setHelpText('Enter a valid email address.')
      .build();
    question.setValidation(validation);
  }
}

function logVerifiedDetails_(form, spreadsheet) {
  const formId = form.getId();
  const editUrl = form.getEditUrl();
  const spreadsheetId = spreadsheet.getId();
  const spreadsheetUrl = spreadsheet.getUrl();

  if (editUrl.indexOf('/d/' + formId + '/') === -1) {
    throw new Error('The verified form ID does not match the ID embedded in its edit URL.');
  }
  if (spreadsheetUrl.indexOf('/d/' + spreadsheetId + '/') === -1) {
    throw new Error('The verified spreadsheet ID does not match the ID embedded in its URL.');
  }

  console.log('Verified form ID: ' + formId);
  console.log('Verified form edit URL: ' + editUrl);
  console.log('Verified spreadsheet ID: ' + spreadsheetId);
  console.log('Verified spreadsheet URL: ' + spreadsheetUrl);
  console.log(
    'Form published: ' +
    (form.supportsAdvancedResponderPermissions() ? String(form.isPublished()) : 'Not exposed for this form type')
  );
  console.log('Form accepting responses: ' + String(form.isAcceptingResponses()));
  console.log('Form response URL: ' + form.getPublishedUrl());
}

function logResumeUploadQuestionStatus_(form) {
  const matchingUploads = form.getItems().filter(function (item) {
    return item.getType() === FormApp.ItemType.FILE_UPLOAD && item.getTitle() === 'Resume PDF Upload';
  });

  if (matchingUploads.length === 0) {
    console.log(
      'Resume PDF Upload is not present. Add it manually in the Forms editor; FormApp cannot create file-upload questions. ' +
      'See google-apps-script/README.md.'
    );
    return;
  }

  console.log(
    'Resume PDF Upload question detected. FormApp cannot verify its required, PDF-only, file-count, or file-size settings; ' +
    'check them in the Forms editor.'
  );
}
