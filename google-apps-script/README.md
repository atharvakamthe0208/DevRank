# DevRank Candidate Information Form

This Apps Script creates the DevRank Google Form, its linked response spreadsheet, and the text questions. It is safe to run `setupDevRankCandidateForm()` again: the script stores resource IDs in Script Properties and reuses them, and it adds missing text questions without duplicating existing ones.

## Important Google Forms limitation

Google's current Forms API documentation says it does not support creating file-upload questions through the API, and Apps Script's `Form` class has no `addFileUploadItem()` method. Although `FormApp.ItemType.FILE_UPLOAD` exists to identify that question type, it does not provide a supported creation method. The script creates and verifies the form and linked spreadsheet, but **you must add the Resume PDF Upload question once in the form editor**. The setup function detects the question by title when possible, but cannot create it or verify its upload settings.

## Setup and authorization

1. Go to [script.google.com](https://script.google.com/) and create a new standalone Apps Script project.
2. Replace the contents of `Code.gs` with the code in this folder's `Code.gs`, then save the project.
3. Select `setupDevRankCandidateForm` in the function selector and click **Run**.
4. On the first run, review Google's authorization prompt and authorize the script to create/manage Google Forms and spreadsheets. Run it again if Google prompts you to complete authorization.
5. The setup function saves each resource ID immediately, then reopens the form with `FormApp.openById()` and verifies the returned ID. It reopens the spreadsheet by ID, links it with `form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId())`, and enables publishing/response acceptance where those settings are supported.
6. Open the execution log. It prints the verified form ID, edit URL, response URL, spreadsheet ID, and spreadsheet URL. These logs confirm the authorized Apps Script account reopened the resources; they do not by themselves prove that the responder link is accessible in Chrome.
7. Open the **Verified form edit URL** and click **Add question (+)**. Change the question type to **File upload** and title it exactly `Resume PDF Upload`. Place it after `Gmail Address` and before the GitHub question so the response columns follow the requested order.
8. In the file-upload question settings, enable **Required**, choose **Allow only specific file types → PDF**, and set **Maximum number of files** to **1**. For **Maximum file size**, choose **10 MB** if that option is available; otherwise choose the nearest available size that fits typical resumes. Save the form.
9. Run `diagnoseDevRankCandidateForm()` and inspect its verification output. The response destination should match the saved spreadsheet ID, the form should be published when publishing is supported, and it should be accepting responses.
10. Test the response URL in Chrome while signed into a Google account allowed by the form's responder settings. Confirm that the page shows **DevRank Candidate Information Form**, complete a test submission with a PDF, and verify a new row and Drive upload link appear in the linked spreadsheet.

The created form contains these required short-answer questions:

- Full Name
- Gmail Address (validated as an email address)
- GitHub Username or Profile URL
- LeetCode Username or Profile URL

The Resume PDF Upload field must be added manually due to the Forms API limitation above. Google Forms lets the owner configure allowed file types, file count, and maximum file size in the editor.

## Reusing and finding the existing form

The first successful creation saves the form and spreadsheet IDs in the Apps Script project's Script Properties. Re-running `setupDevRankCandidateForm()` reuses those resources, verifies them by reopening their saved IDs, ensures the expected text questions exist, and sets the response destination again so a missing or changed link is repaired. It does not create another form or spreadsheet. If a saved ID cannot be opened, the script stops with a clear error instead of risking a duplicate.

To verify or print the saved resource details, select and run `diagnoseDevRankCandidateForm()` and inspect the execution log. `showDevRankCandidateFormLinks()` remains available as an alias. The diagnostic reopens both resources, logs their IDs and URLs, checks the linked destination, and reports publication/response status when available.

If the form ID or spreadsheet ID is invalid, setup stops and does not make a replacement automatically. First confirm whether the resource was deleted or whether the Apps Script account simply lost access. Restore access if it still exists. If it was deleted, remove only its matching property (`DEVRANK_CANDIDATE_FORM_ID` or `DEVRANK_CANDIDATE_SPREADSHEET_ID`) under **Project Settings → Script Properties**, then rerun setup. The other saved resource remains in use. Do not clear both IDs unless both resources were deleted.

## Verify the response link in Chrome

`getPublishedUrl()` returning a URL only means Apps Script constructed the responder URL; it does not verify browser access. Use the response URL printed by the diagnostic function:

1. In Chrome, sign into the same Google account that ran the authorized setup, or another account allowed by the form's responder settings.
2. Open the verified edit URL from the log. Its `/d/<form-id>/edit` segment should contain the exact **Verified form ID** printed in the same log. The script checks this before logging the URL. If the editor says the file does not exist, rerun `diagnoseDevRankCandidateForm()` and confirm the authorized account can still open the saved ID. Do not clear the ID or create a replacement while the existing form may still be valid.
3. Once the edit URL opens, use the form editor's **Preview** button or open the response URL in Chrome. Confirm the response page shows **DevRank Candidate Information Form**.
4. In the form editor, confirm it is published and accepting responses. For form types where Apps Script does not expose publishing controls, publish it manually and turn on response acceptance in the editor.
5. Submit a test response with a small PDF. Open the verified spreadsheet URL and confirm a new row appears with the timestamp and answers, and that the Resume PDF Upload cell contains a Drive link.

Because file-upload questions require Google sign-in, an incognito window without an authorized Google account is not a valid upload test. Workspace responder restrictions can also prevent access from other accounts even when the owner can open the form.

## Sharing the form with your group

1. Use the **Form response URL** from the execution log (or open the form editor and use its responder/share control to copy the responder link).
2. Check the form's responder access settings before sharing. Work or school Google accounts can restrict responders to the organization, depending on account and form settings.
3. Send the responder link to your group by your preferred channel.

**File uploads require respondents to sign in to a Google Account.** Google Forms may also restrict access based on the owner's Workspace settings. Tell candidates to use an account that can access the form. The uploaded resume is stored in the form owner's Google Drive; the response sheet stores a link to the uploaded file, not the resume contents.

## Download responses as CSV

The linked spreadsheet receives submissions automatically. Its response tab will contain the submission timestamp and question responses. After adding the upload question in the stated position, expected columns are:

`Timestamp`, `Full Name`, `Gmail Address`, `Resume Upload`, `GitHub Username or Profile URL`, `LeetCode Username or Profile URL`.

The Resume Upload cell contains the Google Drive file link; the resume file itself is not embedded in the CSV.

To download:

1. Open the **Response spreadsheet URL** from the execution log.
2. Select the form response tab (usually **Form Responses 1**).
3. Choose **File → Download → Comma-separated values (.csv)**. Google Sheets downloads the selected sheet as a CSV file.

## Official references

- [Apps Script Forms service](https://developers.google.com/apps-script/reference/forms)
- [Apps Script Form class: response destination and form URLs](https://developers.google.com/apps-script/reference/forms/form)
- [Google Forms API: file upload question limitation](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms)
- [Google Forms file-upload question settings](https://support.google.com/docs/answer/7322334)
- [Google Forms file-upload sign-in requirement](https://support.google.com/docs/answer/15473134)
- [Download and manage Google Forms responses](https://support.google.com/docs/answer/139706)
