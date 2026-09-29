import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { CodexReviewCard } from './CodexReviewCard'

describe('CodexReviewCard', () => {
    it('renders findings, priority, and source location', () => {
        render(
            <I18nProvider>
                <CodexReviewCard
                    review={{
                        findings: [{
                            title: 'Null check',
                            body: 'Guard the optional value.',
                            priority: 1,
                            confidenceScore: 0.8,
                            filePath: 'src/app.ts',
                            lineStart: 4,
                            lineEnd: 6
                        }],
                        overallCorrectness: 'mostly_correct',
                        overallExplanation: 'One issue found.',
                        overallConfidenceScore: 0.8
                    }}
                />
            </I18nProvider>
        )

        expect(screen.getByText('Codex review')).toBeInTheDocument()
        expect(screen.getByText('Null check')).toBeInTheDocument()
        expect(screen.getByText('P1')).toBeInTheDocument()
        expect(screen.getByText('src/app.ts:4-6')).toBeInTheDocument()
    })
})

