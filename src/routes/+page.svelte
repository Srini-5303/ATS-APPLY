<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>ATS Screener — see your resume the way 6 real ATS platforms do</title>
	<meta
		name="description"
		content="Simulate how Workday, Taleo, iCIMS, Greenhouse, Lever and SuccessFactors parse and score your resume. Free, and your file never leaves the browser."
	/>
</svelte:head>

<section class="hero">
	<h1>Get past ATS.<br />Get the interview.</h1>
	<p>
		Six real enterprise platforms parse resumes differently. See what each one does with yours —
		your file never leaves the browser.
	</p>
	<a class="cta" href={resolve('/scanner')}>Scan your resume</a>
</section>

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-6);
		max-width: 46rem;
		margin-inline: auto;
		padding: var(--space-24) var(--space-6);
		text-align: center;
	}

	h1 {
		font-size: clamp(var(--text-4xl), 8vw, var(--text-6xl));
		font-weight: 700;
		letter-spacing: -0.02em;
		background: var(--gradient-primary);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	p {
		font-size: var(--text-lg);
		color: var(--color-text-secondary);
	}

	.cta {
		padding: var(--space-3) var(--space-8);
		border-radius: var(--radius-full);
		background: var(--gradient-primary);
		color: #06060f;
		font-weight: 600;
		text-decoration: none;
		transition: box-shadow var(--duration-base) var(--ease-out);
	}

	.cta:hover {
		box-shadow: var(--glow-cyan);
	}
</style>
