/**
 * Non-technology synonym groups (PRD §6.3).
 *
 * These domains are seeded rather than exhaustive — filling them out is content authoring,
 * not engineering, and is tracked separately. The lookup structure and the validation tests
 * are identical either way, so extending a domain never touches code.
 *
 * First variant in each group is canonical.
 */

export const FINANCE: readonly (readonly string[])[] = [
	['cpa', 'certified public accountant'],
	['cfa', 'chartered financial analyst'],
	['frm', 'financial risk manager'],
	['gaap', 'generally accepted accounting principles'],
	['ifrs'],
	['accounts payable', 'ap'],
	['accounts receivable', 'ar'],
	['profit and loss', 'p&l', 'pnl'],
	['return on investment', 'roi'],
	['discounted cash flow', 'dcf'],
	['mergers and acquisitions', 'm&a'],
	['initial public offering', 'ipo'],
	['private equity', 'pe'],
	['venture capital', 'vc'],
	['anti-money laundering', 'aml'],
	['know your customer', 'kyc'],
	['financial modeling', 'financial modelling'],
	['forecasting'],
	['budgeting'],
	['audit', 'auditing'],
	['bloomberg', 'bloomberg terminal'],
	['sap'],
	['quickbooks']
];

export const HEALTHCARE: readonly (readonly string[])[] = [
	['electronic health record', 'ehr', 'emr', 'electronic medical record'],
	['epic'],
	['cerner'],
	['hipaa'],
	['icd-10', 'icd10'],
	['cpt'],
	['registered nurse', 'rn'],
	['licensed practical nurse', 'lpn'],
	['nurse practitioner', 'np'],
	['physician assistant', 'pa'],
	['basic life support', 'bls'],
	['advanced cardiac life support', 'acls'],
	['fda'],
	['good manufacturing practice', 'gmp'],
	// The bare "gcp" acronym is deliberately omitted: it collides with Google Cloud Platform,
	// which is far more common on a resume. An acronym owned by two domains makes
	// canonicalisation order-dependent, so ambiguous ones go to the dominant usage only.
	['good clinical practice'],
	['clinical trials', 'clinical trial'],
	['patient care'],
	['telehealth', 'telemedicine']
];

export const MARKETING: readonly (readonly string[])[] = [
	['search engine optimization', 'seo'],
	['search engine marketing', 'sem'],
	['pay per click', 'ppc'],
	['customer relationship management', 'crm'],
	['salesforce', 'sfdc'],
	['hubspot'],
	['marketo'],
	['google analytics', 'ga4', 'ga'],
	['a/b testing', 'ab testing', 'split testing'],
	['conversion rate optimization', 'cro'],
	['customer lifetime value', 'clv', 'ltv'],
	['net promoter score', 'nps'],
	['marketing qualified lead', 'mql'],
	['sales qualified lead', 'sql lead'],
	['content marketing'],
	['email marketing'],
	['social media marketing', 'smm'],
	['brand strategy', 'branding'],
	['demand generation', 'demand gen']
];

export const SALES: readonly (readonly string[])[] = [
	['business development', 'bd', 'bizdev'],
	['account management'],
	['pipeline management'],
	['quota attainment'],
	['cold calling', 'cold outreach'],
	['lead generation', 'lead gen'],
	['solution selling'],
	['upselling', 'upsell'],
	['cross-selling', 'cross sell'],
	['annual recurring revenue', 'arr'],
	['monthly recurring revenue', 'mrr'],
	['customer success'],
	['churn', 'churn rate', 'attrition']
];

export const HR: readonly (readonly string[])[] = [
	['human resources', 'hr'],
	['talent acquisition', 'recruiting', 'recruitment'],
	['applicant tracking system', 'ats'],
	['onboarding'],
	['performance management'],
	['compensation and benefits', 'comp and benefits', 'total rewards'],
	['employee relations'],
	['diversity equity and inclusion', 'dei', 'diversity and inclusion'],
	['workday'],
	['organizational development', 'org development'],
	['succession planning'],
	['hris']
];

export const PRODUCT: readonly (readonly string[])[] = [
	['product management', 'product manager', 'pm'],
	['roadmap', 'product roadmap'],
	['user research', 'ux research'],
	['product-market fit', 'product market fit'],
	['go-to-market', 'gtm', 'go to market'],
	['minimum viable product', 'mvp'],
	['okr', 'objectives and key results'],
	['kpi', 'key performance indicator'],
	['stakeholder management'],
	['user story', 'user stories'],
	['backlog grooming', 'backlog refinement'],
	['wireframe', 'wireframing'],
	['prototyping', 'prototype'],
	['figma'],
	['product analytics']
];

export const LEGAL: readonly (readonly string[])[] = [
	['juris doctor', 'jd'],
	['litigation'],
	['contract negotiation', 'contract drafting'],
	['due diligence'],
	['intellectual property', 'ip'],
	['regulatory compliance', 'compliance'],
	['general data protection regulation', 'gdpr'],
	['ccpa'],
	['corporate governance'],
	['risk management']
];

export const OPERATIONS: readonly (readonly string[])[] = [
	['supply chain', 'supply chain management', 'scm'],
	['logistics'],
	['inventory management'],
	['procurement', 'sourcing'],
	['lean', 'lean manufacturing'],
	['six sigma'],
	['process improvement', 'continuous improvement'],
	['enterprise resource planning', 'erp'],
	['vendor management'],
	['quality assurance', 'qa'],
	['project management', 'pmp'],
	['warehouse management', 'wms']
];

export const EDUCATION_DOMAIN: readonly (readonly string[])[] = [
	['curriculum development', 'curriculum design'],
	['lesson planning'],
	['classroom management'],
	['differentiated instruction'],
	['individualized education program', 'iep'],
	['learning management system', 'lms'],
	['canvas'],
	['blackboard'],
	['student assessment', 'assessment'],
	['special education', 'sped']
];

export const DESIGN: readonly (readonly string[])[] = [
	['user experience', 'ux'],
	['user interface', 'ui'],
	['interaction design', 'ixd'],
	['design system', 'design systems'],
	['adobe creative suite', 'creative suite'],
	['photoshop'],
	['illustrator'],
	['sketch'],
	['invision'],
	['typography'],
	['accessibility', 'a11y', 'wcag'],
	['information architecture', 'ia'],
	['usability testing']
];
