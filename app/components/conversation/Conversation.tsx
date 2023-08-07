'use client'

import {
	goToQuestion,
	updateSituation,
	validateStepWithValue,
} from '@/app/actions'
import { useEngine2 } from '@/app/providers/EngineWrapper'
import { sortBy } from '@/app/utils'
import { airportsQuestions, isMosaic } from 'Components/conversation/RuleInput'
import { useNextQuestions } from 'Components/utils/useNextQuestion'
import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
	answeredQuestionsSelector,
	situationSelector,
} from 'Selectors/simulationSelectors'
import { objectifsSelector } from '../../selectors/simulationSelectors'
import useKeypress from '../utils/useKeyPress'
import './conversation.css'
import { ferryQuestions } from './RuleInput'

export type ConversationProps = {
	customEndMessages?: React.ReactNode
	customEnd?: React.ReactNode
}

export default function Conversation({
	customEndMessages,
	customEnd,
	orderByCategories,
}: ConversationProps) {
	const dispatch = useDispatch()
	const engine = useEngine2(),
		rules = engine.getParsedRules()
	const nextQuestions = useNextQuestions()
	const situation = useSelector(situationSelector)
	const previousAnswers = useSelector(answeredQuestionsSelector)
	const objectifs = useSelector(objectifsSelector)
	const rawRules = useSelector((state) => state.rules)
	const previousSimulation = useSelector((state) => state.previousSimulation)

	const sortedQuestions = orderByCategories
		? sortBy((question) => {
				const categoryIndex = orderByCategories.findIndex(
					(c) => question.indexOf(c.dottedName) === 0
				)
				return categoryIndex * 1000 + nextQuestions.indexOf(question)
		  }, nextQuestions)
		: nextQuestions
	const unfoldedStep = useSelector((state) => state.simulation.unfoldedStep)
	const isMainSimulation = objectifs.length === 1 && objectifs[0] === 'bilan',
		currentQuestion = !isMainSimulation
			? nextQuestions[0]
			: unfoldedStep || sortedQuestions[0]

	useEffect(() => {
		// It is important to test for "previousSimulation" : if it exists, it's not loadedYet. Then currentQuestion could be the wrong one, already answered, don't put it as the unfoldedStep
		// TODO this is really unclear
		if (
			currentQuestion &&
			!previousSimulation &&
			currentQuestion !== unfoldedStep
		) {
			dispatch(goToQuestion(currentQuestion))
		}
	}, [dispatch, currentQuestion, previousAnswers, unfoldedStep, objectifs])

	// Some questions are grouped in an artifical questions, called mosaic questions,  not present in publicodes
	// here we need to submit all of them when the one that triggered the UI (we don't care which) is submitted, in order to see them in the response list and to avoid repeating the same n times

	const mosaicQuestion = currentQuestion && isMosaic(currentQuestion)

	const questionsToSubmit = airportsQuestions.includes(currentQuestion)
		? airportsQuestions
		: ferryQuestions.includes(currentQuestion)
		? ferryQuestions
		: mosaicQuestion
		? Object.entries(rules)
				.filter(([dottedName, value]) =>
					mosaicQuestion.isApplicable(dottedName)
				)
				.map(([dottedName]) => dottedName)
		: [currentQuestion]

	const submit = (source: string) => {
		if (mosaicQuestion?.options?.defaultsToFalse) {
			questionsToSubmit.map((question) =>
				dispatch(updateSituation(question, situation[question] || 'non'))
			)
		}

		questionsToSubmit.map((question) =>
			dispatch({
				type: 'STEP_ACTION',
				name: 'fold',
				step: question,
				source,
			})
		)
	}
	const setDefault = () =>
		// TODO: Skiping a question shouldn't be equivalent to answering the
		// default value (for instance the question shouldn't appear in the
		// answered questions).
		questionsToSubmit.map((question) =>
			dispatch(validateStepWithValue(question, undefined))
		)

	useKeypress('Escape', setDefault, [currentQuestion])
	useKeypress('Enter', () => submit('enter'), [currentQuestion])

	return 'haouiuoi'
	/*
	return (
		<Conversation2
			{...{
				currentQuestion,
				customEnd,
				customEndMessages,
				orderByCategories,
				previousAnswers,
				mosaicQuestion,
				rules,
				engine,
				submit,
				situation,
				unfoldedStep,
			}}
		/>
	)
	*/
}
