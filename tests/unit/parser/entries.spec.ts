import { describe, expect, it } from 'vitest';
import {
	degreeLevel,
	extractCertifications,
	extractEducation,
	extractExperience,
	extractProjects
} from '$engine/parser/entries';
import type { ResumeSection, SectionType } from '$engine/types/parser';

function section(type: SectionType, ...content: string[]): ResumeSection[] {
	return [{ type, heading: type.toUpperCase(), content, startLine: 0, endLine: content.length }];
}

describe('extractExperience', () => {
	it('splits roles and keeps their bullets together', () => {
		const entries = extractExperience(
			section(
				'experience',
				'Senior Software Engineer | Stripe | Jan 2021 - Present',
				'- Reduced p99 latency by 42%',
				'- Led a migration of 120 services',
				'Software Engineer | Twilio | Jun 2018 - Dec 2020',
				'- Built a rate limiter'
			)
		);

		expect(entries).toHaveLength(2);
		expect(entries[0]?.title).toBe('Senior Software Engineer');
		expect(entries[0]?.company).toBe('Stripe');
		expect(entries[0]?.bullets).toHaveLength(2);
		expect(entries[0]?.dates?.isCurrent).toBe(true);
		expect(entries[1]?.company).toBe('Twilio');
	});

	it('does not let a separator inside a date range fragment the header', () => {
		// "Jan 2021 - Present" contains " - ", which is also a header separator; the date has
		// to be removed before the split or the role fragments into nonsense.
		const entries = extractExperience(
			section('experience', 'Product Manager | Acme Inc | Jan 2021 - Dec 2023', '- Shipped things')
		);

		expect(entries[0]?.title).toBe('Product Manager');
		expect(entries[0]?.company).toBe('Acme Inc');
	});

	it('handles a two-line header', () => {
		const entries = extractExperience(
			section('experience', 'Data Analyst', 'Northwind Corp | 2020 - 2022', '- Built dashboards')
		);

		expect(entries[0]?.title).toBe('Data Analyst');
		expect(entries[0]?.company).toBe('Northwind Corp');
	});

	it('picks out a city/state location', () => {
		const entries = extractExperience(
			section('experience', 'Engineer | Acme | San Francisco, CA | 2021 - 2023', '- Did work')
		);

		expect(entries[0]?.location).toBe('San Francisco, CA');
	});

	it('returns nothing for an empty section', () => {
		expect(extractExperience(section('experience'))).toEqual([]);
	});

	it('keeps a role that has bullets but no recognisable header', () => {
		const entries = extractExperience(section('experience', '- Did a thing', '- Did another'));
		expect(entries).toHaveLength(1);
		expect(entries[0]?.bullets).toHaveLength(2);
	});
});

describe('extractEducation', () => {
	it('pulls apart a conventional entry', () => {
		const entries = extractEducation(
			section(
				'education',
				'B.S. Computer Science | University of California, Berkeley | 2018',
				"GPA: 3.8 | Dean's List"
			)
		);

		expect(entries[0]?.degree).toBe('B.S.');
		expect(entries[0]?.field).toBe('Computer Science');
		expect(entries[0]?.institution).toContain('University of California');
		expect(entries[0]?.gpa).toBe('3.8');
		expect(entries[0]?.honors).toContain("dean's list");
	});

	it('does not read the institution\'s "of" as the field of study', () => {
		// "University of California" would otherwise yield field = "California".
		const entries = extractEducation(
			section('education', 'B.A. History | University of Michigan | 2016')
		);

		expect(entries[0]?.field).toBe('History');
	});

	it('reads an explicit "in <field>"', () => {
		const entries = extractEducation(
			section('education', 'Master of Science in Data Science | MIT | 2020')
		);

		expect(entries[0]?.field).toBe('Data Science');
	});

	it.each([
		['PhD Physics | Caltech | 2015', 5],
		['M.S. Statistics | Yale | 2014', 4],
		['B.A. English | NYU | 2012', 3],
		['Associate of Arts | Foothill | 2010', 2],
		['Certificate in Welding | TAFE | 2009', 1]
	])('ranks %s at level %i', (line, level) => {
		const entries = extractEducation(section('education', line));
		expect(degreeLevel(entries[0]?.degree ?? null)).toBe(level);
	});

	it('returns nothing when the section is empty', () => {
		expect(extractEducation(section('education'))).toEqual([]);
	});
});

describe('extractProjects', () => {
	it('reads the name, stack and URL', () => {
		const entries = extractProjects(
			section(
				'projects',
				'Ledger (TypeScript, PostgreSQL, Docker)',
				'- Double-entry accounting engine',
				'- https://github.com/example/ledger'
			)
		);

		expect(entries[0]?.name).toBe('Ledger');
		expect(entries[0]?.techStack).toEqual(['TypeScript', 'PostgreSQL', 'Docker']);
		expect(entries[0]?.url).toContain('github.com/example/ledger');
	});

	it('reads a labelled technologies line', () => {
		const entries = extractProjects(
			section('projects', 'Weather Radar', 'Technologies: Go, Redis', '- Real-time ingest')
		);

		expect(entries[0]?.techStack).toEqual(['Go', 'Redis']);
	});
});

describe('extractCertifications', () => {
	it('reads name, issuer and date', () => {
		const entries = extractCertifications(
			section('certifications', '- AWS Solutions Architect | Amazon Web Services | 2023')
		);

		expect(entries[0]?.name).toBe('AWS Solutions Architect');
		expect(entries[0]?.issuer).toBe('Amazon Web Services');
		expect(entries[0]?.date).toBe('2023');
	});

	it('copes with a bare name', () => {
		const entries = extractCertifications(section('certifications', 'CISSP'));
		expect(entries[0]?.name).toBe('CISSP');
		expect(entries[0]?.issuer).toBeNull();
	});
});
