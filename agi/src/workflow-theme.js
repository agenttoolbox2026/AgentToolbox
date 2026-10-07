import {shell as platformShell} from '../../platform/src/pages.js';
import {header,headerStylesheet} from './header.js';
import {agentStylesheet} from './pages.js';

export const formsStylesheet='<link rel="stylesheet" href="/forms.css?v=e3fbd7e8c618">';

// Derive the recognized shell from the actual renderer instead of maintaining
// another copy of its scripts, version tags or trusted header/footer markup.
const marker='<!-- agenttoolbox-workflow-body-boundary -->';
const template=platformShell(marker);
const markerIndex=template.indexOf(marker);
const prefix=template.slice(0,markerIndex);
const suffix=template.slice(markerIndex+marker.length);
const headOpening=prefix.slice(0,prefix.indexOf('<head>')+6);
const headClosingIndex=prefix.indexOf('</head>');
const legacyBodyOpening=prefix.slice(headClosingIndex);
const legacyStylesheet=prefix.slice(0,headClosingIndex).match(/<link rel="stylesheet" href="\/style\.css(?:\?[^\"]*)?">/)?.[0];
const themedBodyOpening='</head><body><a class="skip-link" href="#main">Skip to content</a>'+header('agents')+'<main id="main" class="document workflow-document">';
const themedSuffix='</main><footer class="document-footer workflow-footer"><nav aria-label="Toolbox links"><a href="/tools">Browse tools</a><a href="/reviews">Reviews</a><a href="/feedback">Private feedback</a><a href="/sell">Sell tools</a><a href="/llms.txt">llms.txt</a><a href="/openapi.json">OpenAPI</a></nav><p>Built for agents, by agents.</p></footer></body></html>';

/**
 * Theme HTML returned by the trusted platform page renderer. This is a shell
 * adapter, not an HTML sanitizer: the platform remains responsible for escaping
 * user content. Only recognized outer boundaries are replaced. The complete
 * main body, including every form, capability field and script hook, is copied
 * verbatim. Additional trusted head metadata/scripts are also retained.
 *
 * Unknown, malformed and already-themed documents are deliberately unchanged.
 * HTTP headers (including CSP) remain the caller's responsibility and are never
 * accepted, synthesized or relaxed by this presentation-only function.
 */
export function themeWorkflowHtml(html){
 if(typeof html!=='string'||!legacyStylesheet||!html.startsWith(headOpening)||!html.endsWith(suffix))return html;
 const headEnd=html.indexOf('</head>',headOpening.length);
 if(headEnd<0||!html.startsWith(legacyBodyOpening,headEnd))return html;
 const bodyStart=headEnd+legacyBodyOpening.length;
 const bodyEnd=html.length-suffix.length;
 if(bodyEnd<bodyStart)return html;
 const head=html.slice(0,headEnd);
 const styles=head.split(legacyStylesheet);
 if(styles.length!==2)return html;
 const themedHead=styles[0]+headerStylesheet+agentStylesheet+formsStylesheet+styles[1];
 return themedHead+themedBodyOpening+html.slice(bodyStart,bodyEnd)+themedSuffix;
}
