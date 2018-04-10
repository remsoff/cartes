import {
	map,
	pluck,
	any,
	equals,
	reduce,
	chain,
	fromPairs,
	keys,
	values,
	evolve,
	filter
} from 'ramda'

export let makeJsx = node =>
	typeof node.jsx == 'function'
		? node.jsx(node.nodeValue, node.explanation)
		: node.jsx

export let collectNodeMissing = node =>
	node.missingVariables ||
		(node.collectMissing ? node.collectMissing(node) : [])

export let evaluateNode = (cache, situationGate, parsedRules, node) =>
	node.evaluate ? node.evaluate(cache, situationGate, parsedRules, node) : node

export let rewriteNode = (node, nodeValue, explanation, collectMissing = null) => ({
	...node,
	nodeValue,
	explanation,
	collectMissing
})

export let evaluateArray = (reducer, start) => (
	cache,
	situationGate,
	parsedRules,
	node
) => {
	let evaluateOne = child =>
			evaluateNode(cache, situationGate, parsedRules, child),
		explanation = map(evaluateOne, node.explanation),
		values = pluck('nodeValue', explanation),
		nodeValue = any(equals(null), values)
			? null
			: reduce(reducer, start, values),
		missingVariables = node.nodeValue == null
			? chain(collectNodeMissing, explanation)
			: []

	return {
		...rewriteNode(node, nodeValue, explanation),
		missingVariables
	}
}

export let evaluateArrayWithFilter = (evaluationFilter, reducer, start) => (
	cache,
	situationGate,
	parsedRules,
	node
) => {
	let evaluateOne = child =>
			evaluateNode(cache, situationGate, parsedRules, child),
		explanation = map(
			evaluateOne,
			filter(evaluationFilter(situationGate), node.explanation)
		),
		values = pluck('nodeValue', explanation),
		nodeValue = any(equals(null), values)
			? null
			: reduce(reducer, start, values),
		missingVariables = node.nodeValue == null
			? chain(collectNodeMissing, explanation)
			: []

	return {
		...rewriteNode(node, nodeValue, explanation),
		missingVariables
	}
}

export let parseObject = (recurse, objectShape, value) => {
	let recurseOne = key => defaultValue => {
		if (!value[key] && !defaultValue) throw "Il manque une valeur '" + key + "'"
		return value[key] ? recurse(value[key]) : defaultValue
	}
	let transforms = fromPairs(map(k => [k, recurseOne(k)], keys(objectShape)))
	return evolve(transforms, objectShape)
}

export let evaluateObject = (objectShape, effect) => (
	cache,
	situationGate,
	parsedRules,
	node
) => {
	let evaluateOne = child =>
			evaluateNode(cache, situationGate, parsedRules, child)

	let transforms = map(k => [k, evaluateOne], keys(objectShape)),
		explanation = evolve(fromPairs(transforms))(node.explanation),
		nodeValue = effect(explanation),
		missingVariables = chain(collectNodeMissing, values(explanation))

	return {
		...rewriteNode(node, nodeValue, explanation),
		missingVariables
	}
}
