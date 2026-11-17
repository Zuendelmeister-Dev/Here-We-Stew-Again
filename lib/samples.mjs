export const categories = [
  { id: 'suppen', name: 'Soups', icon: 'soup' },
  { id: 'vorspeisen', name: 'Starters', icon: 'salad' },
  { id: 'hauptspeisen', name: 'Main Courses', icon: 'utensils' },
];

export const recipes = [
  {
    id: 'geroestete-tomatensuppe',
    title: 'Roasted Tomato Soup',
    categoryId: 'suppen',
    description: 'A silky roasted tomato soup finished with basil and a splash of cream.',
    ingredients: [
      '800 g ripe tomatoes', '1 red onion', '3 garlic cloves', '2 tbsp olive oil',
      '350 ml vegetable stock', '75 ml cream', '1 handful basil', 'Salt and pepper',
    ],
    steps: [
      { text: 'Heat the oven to 220°C (conventional). Halve the tomatoes, cut the onion into wedges and put both on a baking tray with the garlic. Drizzle with olive oil and season with salt.', minutes: 0 },
      { text: 'Roast until the edges of the tomatoes begin to darken.', minutes: 25 },
      { text: 'Transfer the roasted vegetables and their juices to a saucepan. Add the stock and simmer briefly.', minutes: 8 },
      { text: 'Blend until smooth and season to taste with salt and pepper. Serve with cream and fresh basil.', minutes: 0 },
    ],
    notes: 'Toast thick slices of bread in the oven during the last few minutes of roasting and serve them with the soup.',
    image: 'tomatensuppe.jpg',
  },
  {
    id: 'burrata-mit-ofentomaten',
    title: 'Burrata with Roasted Tomatoes',
    categoryId: 'vorspeisen',
    description: 'Creamy burrata, sweet roasted tomatoes and fresh basil.',
    ingredients: [
      '300 g cherry tomatoes', '1 ball of burrata (about 125 g)', '1 garlic clove',
      '2 tbsp olive oil', '1 tsp balsamic vinegar', '1 handful basil', 'Salt and pepper',
    ],
    steps: [
      { text: 'Heat the oven to 200°C (conventional). Put the tomatoes and thinly sliced garlic in a small baking dish with olive oil and salt.', minutes: 0 },
      { text: 'Roast the tomatoes until they burst. Meanwhile, take the burrata out of the fridge.', minutes: 20 },
      { text: 'Spoon the tomatoes and their juices onto a plate. Set the burrata on top, tear it open and finish with balsamic vinegar, pepper and basil.', minutes: 0 },
    ],
    notes: 'Serve with toasted sourdough to soak up the tomato juices.',
    image: 'burrata.jpg',
  },
  {
    id: 'zitronenpasta-mit-kraeutern',
    title: 'Lemon and Herb Pasta',
    categoryId: 'hauptspeisen',
    description: 'Fresh lemon, Parmesan and a handful of herbs make for a quick pasta dinner.',
    ingredients: [
      '250 g linguine', '1 unwaxed lemon', '40 g butter', '60 g Parmesan',
      '1 handful parsley and basil', 'Salt and black pepper',
    ],
    steps: [
      { text: 'Cook the linguine in salted water until al dente, following the packet instructions. Reserve a cup of pasta water before draining.', minutes: 10 },
      { text: 'Melt the butter in a large frying pan. Zest and juice the lemon, then add the zest and a splash of pasta water to the butter.', minutes: 0 },
      { text: 'Stir in the pasta and Parmesan. Add pasta water as needed and toss until the sauce is creamy.', minutes: 2 },
      { text: 'Chop the herbs and fold them in with the lemon juice. Season with pepper.', minutes: 0 },
    ],
    notes: 'Add the lemon juice a little at a time and taste as you go.',
    image: 'zitronenpasta.jpg',
  },
];
