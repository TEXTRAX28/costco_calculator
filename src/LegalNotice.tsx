const openAiData = "https://developers.openai.com/api/docs/guides/your-data";
const privacyEmail: string = import.meta.env.GATHER_PRIVACY_EMAIL;
const privacyOperator: string = import.meta.env.GATHER_PRIVACY_OPERATOR;

export type LegalPage = "privacy" | "terms";

export default function LegalNotice({ page }: { page: LegalPage }) {
  return (
    <div className="legal-notice">
      {page === "privacy" ? (
        <>
          <h2>Privacy Policy</h2>
          <p>This notice describes the private Gather beta.</p>
          {privacyOperator && <p>{privacyOperator} operates Gather.</p>}
          <h3>On this device</h3>
          <p>
            Your browser processes photos, PDF pages and pasted text. Camera
            access is optional. Your active tab holds the original previews and
            pasted text. An editable draft, including extracted receipt details,
            participant names and shares, is saved in this browser when storage
            is available.
          </p>
          <h3>During an OpenAI scan</h3>
          <p>
            When you approve a scan, Gather sends the selected photos or
            rendered PDF pages as JPEG sections to the app server. The server
            forwards the sections to OpenAI and returns the extracted draft. The
            scan request contains receipt images and section numbers. Names you
            enter for splitting and the original PDF stay on your device.
          </p>
          <p>
            Gather requests that OpenAI omit saved response state. OpenAI
            excludes API content from model training by default unless the
            account opts in. Its default abuse monitoring logs may retain
            content for up to 30 days, with longer retention in some cases.
            Provider processing can include caching and transfers outside the
            UK.{" "}
            <a href={openAiData} target="_blank" rel="noreferrer">
              OpenAI API data controls
            </a>
          </p>
          <h3>Gather accounts</h3>
          <p>
            Accounts are optional. For email sign-in, Gather sends your email
            address and password to Firebase Authentication, which manages
            credentials and sends verification and reset emails. If you choose
            Google sign-in, Google returns a verified account identifier and
            email address to Gather.
          </p>
          <p>
            Gather stores an account ID, the sign-in provider’s identifier, your
            verified email address and server session records. An HTTP-only
            cookie keeps you signed in. To limit abuse, Gather counts attempts
            using keyed representations of network addresses and account
            identifiers.
          </p>
          <p>
            When you choose to save a receipt or a split group to your account,
            Gather stores the receipt details, participant names or group
            members and your saved split in its database. Photos, original PDFs
            and raw receipt text stay off that saved copy. You can remove saved
            entries in your account.
          </p>
          <h3>Storage and access</h3>
          <p>
            Gather's app server processes uploads in memory. Its allowance
            record contains a request ID, time and outcome so attempts count
            across restarts. The host receives your IP address and request
            details to connect and protect the service. The private phone
            preview uses a session cookie that expires within eight hours. An
            installed app can cache its program files for offline use. The
            current draft lives in browser storage. The app cache holds program
            files and icons.
          </p>
          <h3>Clear your local data</h3>
          <p>
            Clear local data removes the current draft, names, shares, pasted
            text and imported photos from this browser. Close other Gather tabs
            to discard their open copies. Saved account entries, exports,
            clipboard copies, server allowance records and provider data are
            managed separately. Use your browser settings to remove the app
            cache or session.
          </p>
          <p>
            For privacy questions or requests about server or provider data,{" "}
            {privacyEmail ? (
              <>
                email <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.
              </>
            ) : (
              "contact the person who provided your beta access."
            )}{" "}
            UK users can also{" "}
            <a
              href="https://ico.org.uk/make-a-complaint/"
              target="_blank"
              rel="noreferrer"
            >
              contact the Information Commissioner’s Office
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <h2>Beta Terms</h2>
          <p>
            Gather helps you check receipts and calculate a proposed split. Use
            the beta with the permission of the person who gave you access. Keep
            access credentials private.
          </p>
          <h3>Receipts you provide</h3>
          <p>
            Use receipts you’re allowed to share. Crop out membership numbers,
            payment details and other unnecessary personal information before
            authorizing an OpenAI scan. Manual entry is available if you prefer
            to keep the receipt on your device.
          </p>
          <h3>Review and share</h3>
          <p>
            Scan results can contain mistakes. Check the items, quantities,
            discounts, VAT and final split against the original before sharing
            it or asking anyone to pay. Gather calculates shares. Payments
            happen separately.
          </p>
          <h3>Availability and scan attempts</h3>
          <p>
            Beta access and scan availability can change. OpenAI scanning needs
            a connection and the operator’s API credits. A submission can use an
            app attempt even if it fails or you cancel it after the server
            reserves the attempt. Export any summary you want to keep.
          </p>
          <p>
            For help with beta access, contact the person who invited you. Any
            statutory rights that apply to you still apply.
          </p>
        </>
      )}
    </div>
  );
}
